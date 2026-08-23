import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuthIdentityEntity } from './entities';

export type AuthIdentityProvider = 'apple' | 'email' | 'google';

export interface VerifiedAuthIdentity {
  email: string | null;
  provider: AuthIdentityProvider;
  subject: string;
}

@Injectable()
export class AccountIdentityService {
  constructor(private readonly dataSource: DataSource) {}

  createOrOpen(identity: VerifiedAuthIdentity): Promise<string> {
    return this.dataSource.transaction((manager) =>
      this.createOrOpenWithManager(identity, manager),
    );
  }

  async createOrOpenWithManager(
    identity: VerifiedAuthIdentity,
    manager: EntityManager,
  ): Promise<string> {
    const email = normalizeOptionalEmail(identity.email);
    if (identity.provider === 'email' && email === null) {
      throw new Error('Email identity requires an email address');
    }

    const lockKey = `${identity.provider}:${identity.subject}`;
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [lockKey],
    );

    // Identity ownership is keyed only by (provider, subject). The optional
    // email is display/contact metadata and never links or merges accounts.
    const rows: readonly { account_id: string }[] = await manager.query(
      `WITH existing_identity AS (
         SELECT "account_id"
         FROM "auth"."auth_identities"
         WHERE "provider" = $1 AND "subject" = $2
       ), new_account AS (
         INSERT INTO "auth"."registered_accounts" ("status")
         SELECT 'active'
         WHERE NOT EXISTS (SELECT 1 FROM existing_identity)
         RETURNING "id"
       ), new_identity AS (
         INSERT INTO "auth"."auth_identities" (
           "account_id", "provider", "email", "subject"
         )
         SELECT "id", $1, $3, $2 FROM new_account
         RETURNING "account_id"
       )
       SELECT "account_id" FROM existing_identity
       UNION ALL
       SELECT "account_id" FROM new_identity`,
      [identity.provider, identity.subject, email],
    );

    const accountId = rows[0]?.account_id;
    if (accountId === undefined) {
      throw new Error('Auth identity could not be established');
    }
    return accountId;
  }

  /**
   * Resolves an already-verified `(provider, subject)` pair to the Registered
   * Account that owns it. This lookup is deliberately read-only: deletion
   * reauthentication must be able to reject an unknown or foreign Auth Identity
   * without creating, adopting, linking, or switching an account.
   */
  async findAccountIdForIdentity(
    provider: AuthIdentityProvider,
    subject: string,
  ): Promise<string | null> {
    const existing = await this.dataSource
      .getRepository(AuthIdentityEntity)
      .findOne({ where: { provider, subject } });
    return existing?.accountId ?? null;
  }

  /**
   * Lists the Auth Identities bound to an account without their provider
   * subjects, so a client can offer exactly the sign-in methods that account
   * owns and nothing more.
   */
  async listForAccount(
    accountId: string,
  ): Promise<readonly { email: string | null; provider: AuthIdentityProvider }[]> {
    const identities = await this.dataSource
      .getRepository(AuthIdentityEntity)
      .find({ order: { provider: 'ASC' }, where: { accountId } });
    return identities.map((identity) => ({
      email: identity.email,
      provider: identity.provider,
    }));
  }

  link(accountId: string, identity: VerifiedAuthIdentity): Promise<void> {
    return this.dataSource.transaction((manager) =>
      this.linkWithManager(accountId, identity, manager),
    );
  }

  async linkWithManager(
    accountId: string,
    identity: VerifiedAuthIdentity,
    manager: EntityManager,
  ): Promise<void> {
    const email = normalizeOptionalEmail(identity.email);

    const lockKey = `${identity.provider}:${identity.subject}`;
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [lockKey],
    );

    const existing = await manager.getRepository(AuthIdentityEntity).findOne({
      where: { provider: identity.provider, subject: identity.subject },
    });

    if (existing) {
      if (existing.accountId === accountId) {
        return;
      }
      throw new ConflictException(
        'Provider identity is already bound to another account',
      );
    }

    const newIdentity = manager.getRepository(AuthIdentityEntity).create({
      accountId,
      provider: identity.provider,
      subject: identity.subject,
      email,
    });
    await manager.getRepository(AuthIdentityEntity).save(newIdentity);
  }

  async unlink(
    accountId: string,
    provider: 'apple' | 'email' | 'google',
    subject: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const identities = await manager.getRepository(AuthIdentityEntity).find({
        where: { accountId },
      });

      if (identities.length <= 1) {
        throw new BadRequestException('Cannot remove the last remaining identity');
      }

      const target = identities.find(
        (id) => id.provider === provider && id.subject === subject,
      );
      if (!target) {
        throw new NotFoundException('Identity not found on this account');
      }

      await manager.getRepository(AuthIdentityEntity).remove(target);
    });
  }
}

function normalizeOptionalEmail(email: string | null): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized === undefined || normalized.length === 0 ? null : normalized;
}
