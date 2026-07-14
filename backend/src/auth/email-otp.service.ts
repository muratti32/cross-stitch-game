import { Injectable } from '@nestjs/common';
import {
  createHmac,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import { AppConfigService } from '../config/app-config.service';
import {
  EmailVerificationCodeEntity,
} from './entities';
import { EmailOutboxEntity } from './email-outbox.entity';
import { EmailOtpRateLimiterService } from './email-otp-rate-limiter.service';

@Injectable()
export class EmailOtpService {
  constructor(
    private readonly config: AppConfigService,
    private readonly dataSource: DataSource,
    private readonly rateLimiter: EmailOtpRateLimiterService,
  ) {}

  async request(email: string, ip: string): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const [emailAllowed, ipAllowed] = await Promise.all([
      this.rateLimiter.consumeEmail(normalizedEmail),
      this.rateLimiter.consumeIp(ip),
    ]);
    if (!emailAllowed || !ipAllowed) {
      return;
    }

    const code = generateEmailOtp();
    const codeVerifier = this.hashCode(code);
    const ipHash = createHmac('sha256', this.config.otpSigningSecret)
      .update(ip)
      .digest('hex');

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [normalizedEmail],
      );
      await manager
        .getRepository(EmailVerificationCodeEntity)
        .createQueryBuilder()
        .update()
        .set({ supersededAt: new Date() })
        .where('email = :email', { email: normalizedEmail })
        .andWhere('consumed_at IS NULL')
        .andWhere('superseded_at IS NULL')
        .execute();

      const codes = manager.getRepository(EmailVerificationCodeEntity);
      const verification = await codes.save(
        codes.create({
          attempts: 0,
          codeVerifier,
          consumedAt: null,
          email: normalizedEmail,
          expiresAt: new Date(
            Date.now() + this.config.emailOtpTtlSeconds * 1_000,
          ),
          ipHash,
          maxAttempts: this.config.emailOtpMaxAttempts,
          supersededAt: null,
        }),
      );

      const outbox = manager.getRepository(EmailOutboxEntity);
      await outbox.save(
        outbox.create({
          attempts: 0,
          dedupeKey: verification.id,
          dispatchedAt: null,
          payload: { code, codeId: verification.id },
          template: 'email_otp',
          toEmail: normalizedEmail,
        }),
      );
    });
  }

  async verify(email: string, code: string): Promise<string | null> {
    const normalizedEmail = normalizeEmail(email);
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [normalizedEmail],
      );
      const verification = await manager
        .getRepository(EmailVerificationCodeEntity)
        .createQueryBuilder('verification')
        .where('verification.email = :email', { email: normalizedEmail })
        .andWhere('verification.consumed_at IS NULL')
        .andWhere('verification.superseded_at IS NULL')
        .orderBy('verification.created_at', 'DESC')
        .setLock('pessimistic_write')
        .getOne();
      if (verification === null) {
        return null;
      }

      if (
        verification.expiresAt.getTime() <= Date.now() ||
        verification.attempts >= verification.maxAttempts
      ) {
        return null;
      }

      if (!this.matchesVerifier(code, verification.codeVerifier)) {
        await this.incrementAttempts(verification.id, manager);
        return null;
      }

      const consumed = await manager
        .getRepository(EmailVerificationCodeEntity)
        .update(
          { consumedAt: IsNull(), id: verification.id },
          { consumedAt: new Date() },
        );
      if (consumed.affected !== 1) {
        return null;
      }

      return this.createOrOpenAccount(normalizedEmail, manager);
    });
  }

  hashCode(code: string): string {
    return createHmac('sha256', this.config.otpSigningSecret)
      .update(code)
      .digest('hex');
  }

  matchesVerifier(code: string, verifier: string): boolean {
    const expected = Buffer.from(this.hashCode(code), 'hex');
    const received = Buffer.from(verifier, 'hex');
    return (
      expected.length === received.length &&
      timingSafeEqual(expected, received)
    );
  }

  private async incrementAttempts(
    codeId: string,
    manager: EntityManager,
  ): Promise<void> {
    await manager.query(
      `UPDATE "auth"."email_verification_codes"
       SET "attempts" = "attempts" + 1
       WHERE "id" = $1 AND "consumed_at" IS NULL AND "superseded_at" IS NULL`,
      [codeId],
    );
  }

  private async createOrOpenAccount(
    email: string,
    manager: EntityManager,
  ): Promise<string> {
    // Serialized per-email by the advisory lock held in verify(), so this
    // read-then-conditional-insert cannot race. The account row is created only
    // when no identity exists yet — never leaving an orphan account behind on
    // sign-in to an existing account.
    const rows: readonly { account_id: string }[] = await manager.query(
      `WITH existing_identity AS (
         SELECT "account_id"
         FROM "auth"."auth_identities"
         WHERE "provider" = 'email' AND "email" = $1
       ), new_account AS (
         INSERT INTO "auth"."registered_accounts" ("status")
         SELECT 'active'
         WHERE NOT EXISTS (SELECT 1 FROM existing_identity)
         RETURNING "id"
       ), new_identity AS (
         INSERT INTO "auth"."auth_identities" (
           "account_id", "provider", "email", "subject"
         )
         SELECT "id", 'email', $1, $1 FROM new_account
         RETURNING "account_id"
       )
       SELECT "account_id" FROM existing_identity
       UNION ALL
       SELECT "account_id" FROM new_identity`,
      [email],
    );
    const accountId = rows[0]?.account_id;
    if (accountId === undefined) {
      throw new Error('Email identity could not be established');
    }
    return accountId;
  }
}

export function generateEmailOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
