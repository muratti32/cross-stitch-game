import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEmailAuthSchema1784160000001 implements MigrationInterface {
  readonly name = 'CreateEmailAuthSchema1784160000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "notifications"');

    await queryRunner.query(`
      CREATE TABLE "auth"."registered_accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "status" varchar(16) NOT NULL DEFAULT 'active',
        CONSTRAINT "PK_registered_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_registered_accounts_status"
          CHECK ("status" IN ('active', 'closed'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "auth"."auth_identities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "provider" varchar(32) NOT NULL,
        "email" varchar(254) NOT NULL,
        "subject" varchar(254) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auth_identities" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_auth_identities_provider_email" UNIQUE ("provider", "email"),
        CONSTRAINT "UQ_auth_identities_provider_subject" UNIQUE ("provider", "subject"),
        CONSTRAINT "FK_auth_identities_account"
          FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_auth_identities_provider" CHECK ("provider" = 'email'),
        CONSTRAINT "CHK_auth_identities_email_lowercase"
          CHECK ("email" = lower("email"))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "auth"."email_verification_codes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" varchar(254) NOT NULL,
        "code_verifier" char(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL,
        "consumed_at" timestamptz,
        "superseded_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "ip_hash" varchar(64),
        CONSTRAINT "PK_email_verification_codes" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_email_verification_codes_email_lowercase"
          CHECK ("email" = lower("email"))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_email_verification_codes_email"
      ON "auth"."email_verification_codes" ("email")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_email_verification_codes_active_email"
      ON "auth"."email_verification_codes" ("email")
      WHERE "consumed_at" IS NULL AND "superseded_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "notifications"."email_outbox" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "dedupe_key" varchar(128) NOT NULL,
        "to_email" varchar(254) NOT NULL,
        "template" varchar(32) NOT NULL,
        "payload" jsonb NOT NULL,
        "dispatched_at" timestamptz,
        "attempts" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_email_outbox" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_email_outbox_dedupe_key" UNIQUE ("dedupe_key"),
        CONSTRAINT "CHK_email_outbox_template" CHECK ("template" = 'email_otp')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_email_outbox_undispatched"
      ON "notifications"."email_outbox" ("created_at", "id")
      WHERE "dispatched_at" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "notifications"."email_outbox"');
    await queryRunner.query('DROP TABLE IF EXISTS "auth"."email_verification_codes"');
    await queryRunner.query('DROP TABLE IF EXISTS "auth"."auth_identities"');
    await queryRunner.query('DROP TABLE IF EXISTS "auth"."registered_accounts"');
    await queryRunner.query('DROP SCHEMA IF EXISTS "notifications"');
  }
}
