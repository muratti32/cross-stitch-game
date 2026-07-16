import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

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
}

function normalizeOptionalEmail(email: string | null): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized === undefined || normalized.length === 0 ? null : normalized;
}
