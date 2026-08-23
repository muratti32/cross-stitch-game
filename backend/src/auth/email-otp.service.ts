import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  createHmac,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import { AppConfigService } from '../config/app-config.service';
import { AccountIdentityService } from './account-identity.service';
import {
  EmailVerificationCodeEntity,
} from './entities';
import { EmailOutboxEntity } from './email-outbox.entity';
import { EmailOtpRateLimiterService } from './email-otp-rate-limiter.service';

/**
 * Outcome of consuming an Email Sign-In code for deletion reauthentication.
 * `accountId` is `null` when the code was valid but no Auth Identity exists for
 * that address, which the caller must reject rather than turn into a new
 * Registered Account.
 */
export type EmailReauthenticationOutcome =
  | { kind: 'invalid-code' }
  | { kind: 'verified'; accountId: string | null };

@Injectable()
export class EmailOtpService {
  constructor(
    private readonly config: AppConfigService,
    private readonly dataSource: DataSource,
    private readonly rateLimiter: EmailOtpRateLimiterService,
    private readonly accountIdentities: AccountIdentityService,
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

  async verifyOtpOnly(
    normalizedEmail: string,
    code: string,
    manager: EntityManager,
  ): Promise<boolean> {
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
      return false;
    }

    if (
      verification.expiresAt.getTime() <= Date.now() ||
      verification.attempts >= verification.maxAttempts
    ) {
      return false;
    }

    if (!this.matchesVerifier(code, verification.codeVerifier)) {
      await this.incrementAttempts(verification.id, manager);
      return false;
    }

    const consumed = await manager
      .getRepository(EmailVerificationCodeEntity)
      .update(
        { consumedAt: IsNull(), id: verification.id },
        { consumedAt: new Date() },
      );
    return consumed.affected === 1;
  }

  async verify(email: string, code: string): Promise<string | null> {
    const normalizedEmail = normalizeEmail(email);
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [normalizedEmail],
      );
      const ok = await this.verifyOtpOnly(normalizedEmail, code, manager);
      if (!ok) {
        return null;
      }
      return this.accountIdentities.createOrOpenWithManager(
        {
          email: normalizedEmail,
          provider: 'email',
          subject: normalizedEmail,
        },
        manager,
      );
    });
  }

  /**
   * Consumes an Email Sign-In code for reauthentication only. Unlike `verify`
   * this never creates or opens a Registered Account: it resolves the existing
   * email Auth Identity, so a code for an unknown address cannot mint one.
   */
  async verifyForReauthentication(
    email: string,
    code: string,
  ): Promise<EmailReauthenticationOutcome> {
    const normalizedEmail = normalizeEmail(email);
    const verified = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [normalizedEmail],
      );
      return this.verifyOtpOnly(normalizedEmail, code, manager);
    });

    if (!verified) {
      return { kind: 'invalid-code' };
    }

    const accountId = await this.accountIdentities.findAccountIdForIdentity(
      'email',
      normalizedEmail,
    );
    return { accountId, kind: 'verified' };
  }

  async verifyAndLink(
    accountId: string,
    email: string,
    code: string,
  ): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [normalizedEmail],
      );
      const ok = await this.verifyOtpOnly(normalizedEmail, code, manager);
      if (!ok) {
        throw new UnauthorizedException('Invalid email verification code');
      }
      await this.accountIdentities.linkWithManager(
        accountId,
        {
          email: normalizedEmail,
          provider: 'email',
          subject: normalizedEmail,
        },
        manager,
      );
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

}

export function generateEmailOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
