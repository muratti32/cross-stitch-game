import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCatalogSubmissions1786147200000 implements MigrationInterface {
  readonly name = 'CreateCatalogSubmissions1786147200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "catalog"."patterns" ADD COLUMN "description" text`);
    await queryRunner.query(`ALTER TABLE "catalog"."patterns" ADD COLUMN "source_language" varchar(16)`);
    await queryRunner.query(`ALTER TABLE "catalog"."patterns" ADD COLUMN "creator_profile_id" uuid`);
    await queryRunner.query(`
      ALTER TABLE "catalog"."patterns"
      ADD CONSTRAINT "FK_patterns_creator_profile"
      FOREIGN KEY ("creator_profile_id") REFERENCES "moderation"."creator_profiles" ("id")
      ON DELETE RESTRICT
    `);
    await queryRunner.query(`CREATE INDEX "IDX_patterns_creator_profile" ON "catalog"."patterns" ("creator_profile_id")`);

    await queryRunner.query(`
      CREATE TABLE "catalog"."catalog_submissions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "creator_profile_id" uuid NOT NULL,
        "source_pattern_id" uuid NOT NULL,
        "processing_job_id" uuid NOT NULL,
        "title" varchar(120) NOT NULL,
        "description" varchar(2000) NOT NULL,
        "source_language" varchar(16) NOT NULL,
        "category_code" varchar(64) NOT NULL,
        "tag_codes" text[] NOT NULL DEFAULT '{}',
        "rights_declared" boolean NOT NULL,
        "license_version" varchar(32) NOT NULL,
        "rights_declared_at" timestamptz NOT NULL,
        "artifact_object_key" varchar(512) NOT NULL,
        "artifact_checksum" char(64) NOT NULL,
        "artifact_byte_length" integer NOT NULL,
        "artifact_schema_version" integer NOT NULL,
        "width" integer NOT NULL,
        "height" integer NOT NULL,
        "palette_size" integer NOT NULL,
        "preview_object_key" varchar(512) NOT NULL,
        "preview_checksum" char(64) NOT NULL,
        "preview_phash" varchar(16),
        "metadata_valid" boolean,
        "metadata_errors" jsonb,
        "technical_valid" boolean,
        "technical_errors" jsonb,
        "moderation_evidence" jsonb,
        "similarity_evidence" jsonb,
        "status" varchar(32) NOT NULL DEFAULT 'precheck_pending',
        "rejection_reason" varchar(32),
        "rejection_note" text,
        "initial_moderator_id" uuid,
        "community_pattern_id" uuid,
        "precheck_completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_submissions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_catalog_submissions_job" UNIQUE ("processing_job_id"),
        CONSTRAINT "UQ_catalog_submissions_community_pattern" UNIQUE ("community_pattern_id"),
        CONSTRAINT "FK_catalog_submissions_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_submissions_creator_profile" FOREIGN KEY ("creator_profile_id") REFERENCES "moderation"."creator_profiles" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_submissions_source_pattern" FOREIGN KEY ("source_pattern_id") REFERENCES "catalog"."patterns" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_submissions_job" FOREIGN KEY ("processing_job_id") REFERENCES "jobs"."processing_jobs" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_submissions_category" FOREIGN KEY ("category_code") REFERENCES "catalog"."categories" ("code") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_submissions_initial_moderator" FOREIGN KEY ("initial_moderator_id") REFERENCES "admin"."operator_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_submissions_community_pattern" FOREIGN KEY ("community_pattern_id") REFERENCES "catalog"."patterns" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_catalog_submissions_status" CHECK ("status" IN ('precheck_pending', 'review_pending', 'quarantined', 'precheck_failed', 'rejected', 'appeal_pending', 'appeal_upheld', 'accepted')),
        CONSTRAINT "CHK_catalog_submissions_rights" CHECK ("rights_declared" = true),
        CONSTRAINT "CHK_catalog_submissions_dimensions" CHECK ("width" BETWEEN 1 AND 300 AND "height" BETWEEN 1 AND 300),
        CONSTRAINT "CHK_catalog_submissions_tag_count" CHECK (cardinality("tag_codes") <= 5),
        CONSTRAINT "CHK_catalog_submissions_rejection_reason" CHECK ("rejection_reason" IS NULL OR "rejection_reason" IN ('safety', 'publication_rights', 'duplicate_or_spam', 'technical_invalidity', 'quality_standard'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_catalog_submissions_account" ON "catalog"."catalog_submissions" ("account_id", "created_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_catalog_submissions_review_queue" ON "catalog"."catalog_submissions" ("status", "created_at")`);

    await queryRunner.query(`
      CREATE TABLE "catalog"."catalog_appeals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "submission_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "note" varchar(1000),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_appeals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_catalog_appeals_submission" UNIQUE ("submission_id"),
        CONSTRAINT "FK_catalog_appeals_submission" FOREIGN KEY ("submission_id") REFERENCES "catalog"."catalog_submissions" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_appeals_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "catalog"."catalog_review_decisions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "submission_id" uuid NOT NULL,
        "review_round" varchar(16) NOT NULL,
        "decision" varchar(16) NOT NULL,
        "operator_account_id" uuid NOT NULL,
        "rejection_reason" varchar(32),
        "note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_review_decisions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_catalog_review_decisions_round" UNIQUE ("submission_id", "review_round"),
        CONSTRAINT "FK_catalog_review_decisions_submission" FOREIGN KEY ("submission_id") REFERENCES "catalog"."catalog_submissions" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_review_decisions_operator" FOREIGN KEY ("operator_account_id") REFERENCES "admin"."operator_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_catalog_review_decisions_round" CHECK ("review_round" IN ('initial', 'appeal')),
        CONSTRAINT "CHK_catalog_review_decisions_decision" CHECK ("decision" IN ('accepted', 'rejected')),
        CONSTRAINT "CHK_catalog_review_decisions_rejection" CHECK (("decision" = 'accepted' AND "rejection_reason" IS NULL) OR ("decision" = 'rejected' AND "rejection_reason" IN ('safety', 'publication_rights', 'duplicate_or_spam', 'technical_invalidity', 'quality_standard')))
      )
    `);

    await queryRunner.query(`
      CREATE FUNCTION "catalog"."reject_catalog_submission_snapshot_change"()
      RETURNS trigger AS $$
      BEGIN
        IF ROW(NEW."account_id", NEW."creator_profile_id", NEW."source_pattern_id", NEW."processing_job_id", NEW."title", NEW."description", NEW."source_language", NEW."category_code", NEW."tag_codes", NEW."rights_declared", NEW."license_version", NEW."rights_declared_at", NEW."artifact_object_key", NEW."artifact_checksum", NEW."artifact_byte_length", NEW."artifact_schema_version", NEW."width", NEW."height", NEW."palette_size", NEW."preview_object_key", NEW."preview_checksum")
          IS DISTINCT FROM
           ROW(OLD."account_id", OLD."creator_profile_id", OLD."source_pattern_id", OLD."processing_job_id", OLD."title", OLD."description", OLD."source_language", OLD."category_code", OLD."tag_codes", OLD."rights_declared", OLD."license_version", OLD."rights_declared_at", OLD."artifact_object_key", OLD."artifact_checksum", OLD."artifact_byte_length", OLD."artifact_schema_version", OLD."width", OLD."height", OLD."palette_size", OLD."preview_object_key", OLD."preview_checksum") THEN
          RAISE EXCEPTION 'Catalog Submission snapshot is immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_catalog_submission_snapshot_immutable"
      BEFORE UPDATE ON "catalog"."catalog_submissions"
      FOR EACH ROW EXECUTE FUNCTION "catalog"."reject_catalog_submission_snapshot_change"()
    `);

    await queryRunner.query(`
      CREATE FUNCTION "catalog"."reject_catalog_review_history_mutation"()
      RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Catalog review history is append-only'; END; $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_catalog_appeals_append_only" BEFORE UPDATE OR DELETE ON "catalog"."catalog_appeals"
      FOR EACH ROW EXECUTE FUNCTION "catalog"."reject_catalog_review_history_mutation"()
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_catalog_review_decisions_append_only" BEFORE UPDATE OR DELETE ON "catalog"."catalog_review_decisions"
      FOR EACH ROW EXECUTE FUNCTION "catalog"."reject_catalog_review_history_mutation"()
    `);

    await queryRunner.query(`
      CREATE FUNCTION "catalog"."reject_community_pattern_bytes_change"()
      RETURNS trigger AS $$
      BEGIN
        IF OLD."creator_profile_id" IS NOT NULL AND ROW(NEW."creator_profile_id", NEW."artifact_object_key", NEW."artifact_checksum", NEW."artifact_byte_length", NEW."artifact_schema_version", NEW."preview_object_key", NEW."width", NEW."height", NEW."palette_size") IS DISTINCT FROM ROW(OLD."creator_profile_id", OLD."artifact_object_key", OLD."artifact_checksum", OLD."artifact_byte_length", OLD."artifact_schema_version", OLD."preview_object_key", OLD."width", OLD."height", OLD."palette_size") THEN
          RAISE EXCEPTION 'Community Pattern bytes and creator reference are immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_community_pattern_bytes_immutable" BEFORE UPDATE ON "catalog"."patterns"
      FOR EACH ROW EXECUTE FUNCTION "catalog"."reject_community_pattern_bytes_change"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_community_pattern_bytes_immutable" ON "catalog"."patterns"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "catalog"."reject_community_pattern_bytes_change"()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_catalog_review_decisions_append_only" ON "catalog"."catalog_review_decisions"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_catalog_appeals_append_only" ON "catalog"."catalog_appeals"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "catalog"."reject_catalog_review_history_mutation"()`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_catalog_submission_snapshot_immutable" ON "catalog"."catalog_submissions"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "catalog"."reject_catalog_submission_snapshot_change"()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "catalog"."catalog_review_decisions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "catalog"."catalog_appeals"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "catalog"."catalog_submissions"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "catalog"."IDX_patterns_creator_profile"`);
    await queryRunner.query(`ALTER TABLE "catalog"."patterns" DROP CONSTRAINT IF EXISTS "FK_patterns_creator_profile"`);
    await queryRunner.query(`ALTER TABLE "catalog"."patterns" DROP COLUMN IF EXISTS "creator_profile_id"`);
    await queryRunner.query(`ALTER TABLE "catalog"."patterns" DROP COLUMN IF EXISTS "source_language"`);
    await queryRunner.query(`ALTER TABLE "catalog"."patterns" DROP COLUMN IF EXISTS "description"`);
  }
}
