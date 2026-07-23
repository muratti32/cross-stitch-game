import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCreatorProfiles1786060800000 implements MigrationInterface {
  readonly name = 'CreateCreatorProfiles1786060800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "moderation"');
    await queryRunner.query(`
      CREATE TABLE "moderation"."creator_profiles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "username" varchar(30) NOT NULL,
        "display_name" varchar(50) NOT NULL,
        "avatar_object_key" varchar(512),
        "avatar_content_type" varchar(32),
        "avatar_checksum" varchar(64),
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_creator_profiles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_creator_profiles_account" UNIQUE ("account_id"),
        CONSTRAINT "UQ_creator_profiles_username" UNIQUE ("username"),
        CONSTRAINT "FK_creator_profiles_account"
          FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_creator_profiles_username"
          CHECK ("username" = lower("username") AND "username" ~ '^[a-z0-9_]{3,30}$'),
        CONSTRAINT "CHK_creator_profiles_display_name"
          CHECK (char_length(btrim("display_name")) BETWEEN 1 AND 50),
        CONSTRAINT "CHK_creator_profiles_version" CHECK ("version" > 0),
        CONSTRAINT "CHK_creator_profiles_avatar"
          CHECK (
            ("avatar_object_key" IS NULL AND "avatar_content_type" IS NULL AND "avatar_checksum" IS NULL)
            OR
            ("avatar_object_key" IS NOT NULL AND "avatar_content_type" IS NOT NULL AND "avatar_checksum" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "moderation"."creator_profile_audit" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "profile_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "username" varchar(30) NOT NULL,
        "display_name" varchar(50) NOT NULL,
        "avatar_object_key" varchar(512),
        "avatar_content_type" varchar(32),
        "avatar_checksum" varchar(64),
        "actor_type" varchar(16) NOT NULL,
        "actor_id" uuid,
        "reason" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_creator_profile_audit" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_creator_profile_audit_version" UNIQUE ("profile_id", "version"),
        CONSTRAINT "FK_creator_profile_audit_profile"
          FOREIGN KEY ("profile_id") REFERENCES "moderation"."creator_profiles" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_creator_profile_audit_actor_type"
          CHECK ("actor_type" IN ('account', 'operator', 'system')),
        CONSTRAINT "CHK_creator_profile_audit_version" CHECK ("version" > 0),
        CONSTRAINT "CHK_creator_profile_audit_actor"
          CHECK ("actor_type" = 'system' OR "actor_id" IS NOT NULL),
        CONSTRAINT "CHK_creator_profile_audit_avatar"
          CHECK (
            ("avatar_object_key" IS NULL AND "avatar_content_type" IS NULL AND "avatar_checksum" IS NULL)
            OR
            ("avatar_object_key" IS NOT NULL AND "avatar_content_type" IS NOT NULL AND "avatar_checksum" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE FUNCTION "moderation"."reject_creator_profile_username_change"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."username" IS DISTINCT FROM OLD."username" THEN
          RAISE EXCEPTION 'Creator Profile username is immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_creator_profile_username_immutable"
      BEFORE UPDATE OF "username" ON "moderation"."creator_profiles"
      FOR EACH ROW EXECUTE FUNCTION "moderation"."reject_creator_profile_username_change"()
    `);
    await queryRunner.query(`
      CREATE FUNCTION "moderation"."reject_creator_profile_audit_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Creator Profile Audit is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_creator_profile_audit_append_only"
      BEFORE UPDATE OR DELETE ON "moderation"."creator_profile_audit"
      FOR EACH ROW EXECUTE FUNCTION "moderation"."reject_creator_profile_audit_mutation"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_creator_profile_audit_append_only" ON "moderation"."creator_profile_audit"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS "moderation"."reject_creator_profile_audit_mutation"()',
    );
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_creator_profile_username_immutable" ON "moderation"."creator_profiles"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS "moderation"."reject_creator_profile_username_change"()',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "moderation"."creator_profile_audit"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "moderation"."creator_profiles"',
    );
    await queryRunner.query('DROP SCHEMA IF EXISTS "moderation"');
  }
}
