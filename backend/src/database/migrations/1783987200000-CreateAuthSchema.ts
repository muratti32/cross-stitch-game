import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthSchema1783987200000 implements MigrationInterface {
  readonly name = 'CreateAuthSchema1783987200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "auth"');

    await queryRunner.query(`
      CREATE TABLE "auth"."guest_installations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "installation_key_hash" varchar(64) NOT NULL,
        "credential_hash" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "last_seen_at" timestamptz NOT NULL DEFAULT now(),
        "status" varchar(16) NOT NULL DEFAULT 'active',
        CONSTRAINT "PK_guest_installations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_guest_installations_installation_key_hash"
          UNIQUE ("installation_key_hash"),
        CONSTRAINT "CHK_guest_installations_status"
          CHECK ("status" IN ('active', 'revoked'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "auth"."refresh_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "principal_type" varchar(32) NOT NULL,
        "principal_id" uuid NOT NULL,
        "token_hash" varchar(64) NOT NULL,
        "family_id" uuid NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'active',
        "expires_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "rotated_at" timestamptz,
        CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_refresh_tokens_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "CHK_refresh_tokens_status"
          CHECK ("status" IN ('active', 'rotated', 'revoked'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_tokens_principal_status"
      ON "auth"."refresh_tokens" ("principal_type", "principal_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_refresh_tokens_family_id"
      ON "auth"."refresh_tokens" ("family_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "auth"."refresh_tokens"');
    await queryRunner.query(
      'DROP TABLE IF EXISTS "auth"."guest_installations"',
    );
    await queryRunner.query('DROP SCHEMA IF EXISTS "auth"');
  }
}
