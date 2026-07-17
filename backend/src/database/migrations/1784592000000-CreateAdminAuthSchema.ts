import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminAuthSchema1784592000000
  implements MigrationInterface
{
  readonly name = 'CreateAdminAuthSchema1784592000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "admin"');

    // Operator Accounts are entirely game-owned and disjoint from player
    // identity (auth.registered_accounts / auth.guest_installations): no
    // shared table, no shared token secret, no shared principal type.
    await queryRunner.query(`
      CREATE TABLE "admin"."operator_accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" varchar(254) NOT NULL,
        "password_hash" varchar(255) NOT NULL,
        "totp_secret_encrypted" text NOT NULL,
        "role" varchar(32) NOT NULL DEFAULT 'owner',
        "disabled" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_operator_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_operator_accounts_email" UNIQUE ("email"),
        CONSTRAINT "CHK_operator_accounts_role" CHECK ("role" IN ('owner'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "admin"."operator_recovery_codes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "operator_account_id" uuid NOT NULL,
        "code_hash" varchar(64) NOT NULL,
        "used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_operator_recovery_codes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_operator_recovery_codes_code_hash" UNIQUE ("code_hash"),
        CONSTRAINT "FK_operator_recovery_codes_account"
          FOREIGN KEY ("operator_account_id")
          REFERENCES "admin"."operator_accounts" ("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_operator_recovery_codes_account"
      ON "admin"."operator_recovery_codes" ("operator_account_id")
    `);

    // Opaque rotating refresh tokens, mirroring auth.refresh_tokens' reuse
    // detection shape but scoped to a single principal kind (no polymorphism).
    await queryRunner.query(`
      CREATE TABLE "admin"."operator_refresh_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "operator_account_id" uuid NOT NULL,
        "token_hash" varchar(64) NOT NULL,
        "family_id" uuid NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'active',
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "rotated_at" timestamptz,
        CONSTRAINT "PK_operator_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_operator_refresh_tokens_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "CHK_operator_refresh_tokens_status"
          CHECK ("status" IN ('active', 'rotated', 'revoked')),
        CONSTRAINT "FK_operator_refresh_tokens_account"
          FOREIGN KEY ("operator_account_id")
          REFERENCES "admin"."operator_accounts" ("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_operator_refresh_tokens_account_status"
      ON "admin"."operator_refresh_tokens" ("operator_account_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_operator_refresh_tokens_family_id"
      ON "admin"."operator_refresh_tokens" ("family_id")
    `);

    // Short-lived server-side record bridging POST /admin/auth/login's
    // mfa_required response to POST /admin/auth/mfa's TOTP/recovery-code step.
    await queryRunner.query(`
      CREATE TABLE "admin"."operator_login_challenges" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "operator_account_id" uuid NOT NULL,
        "challenge_hash" varchar(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_operator_login_challenges" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_operator_login_challenges_challenge_hash" UNIQUE ("challenge_hash"),
        CONSTRAINT "FK_operator_login_challenges_account"
          FOREIGN KEY ("operator_account_id")
          REFERENCES "admin"."operator_accounts" ("id")
          ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "admin"."operator_login_challenges"');
    await queryRunner.query('DROP TABLE IF EXISTS "admin"."operator_refresh_tokens"');
    await queryRunner.query('DROP TABLE IF EXISTS "admin"."operator_recovery_codes"');
    await queryRunner.query('DROP TABLE IF EXISTS "admin"."operator_accounts"');
    await queryRunner.query('DROP SCHEMA IF EXISTS "admin"');
  }
}
