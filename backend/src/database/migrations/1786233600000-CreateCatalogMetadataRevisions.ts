import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCatalogMetadataRevisions1786233600000 implements MigrationInterface {
  readonly name = 'CreateCatalogMetadataRevisions1786233600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "catalog"."catalog_metadata_revisions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "creator_profile_id" uuid NOT NULL,
        "community_pattern_id" uuid NOT NULL,
        "title" varchar(120) NOT NULL,
        "description" varchar(2000) NOT NULL,
        "source_language" varchar(16) NOT NULL,
        "category_code" varchar(64) NOT NULL,
        "tag_codes" text[] NOT NULL DEFAULT '{}',
        "metadata_valid" boolean,
        "metadata_errors" jsonb,
        "moderation_evidence" jsonb,
        "status" varchar(32) NOT NULL DEFAULT 'pending',
        "rejection_reason" varchar(32),
        "rejection_note" text,
        "initial_moderator_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_metadata_revisions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_catalog_metadata_revisions_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_metadata_revisions_creator_profile" FOREIGN KEY ("creator_profile_id") REFERENCES "moderation"."creator_profiles" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_metadata_revisions_community_pattern" FOREIGN KEY ("community_pattern_id") REFERENCES "catalog"."patterns" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_metadata_revisions_category" FOREIGN KEY ("category_code") REFERENCES "catalog"."categories" ("code") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_metadata_revisions_initial_moderator" FOREIGN KEY ("initial_moderator_id") REFERENCES "admin"."operator_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_catalog_metadata_revisions_status" CHECK ("status" IN ('pending', 'rejected', 'appeal_pending', 'appeal_upheld', 'accepted', 'withdrawn')),
        CONSTRAINT "CHK_catalog_metadata_revisions_tag_count" CHECK (cardinality("tag_codes") <= 5),
        CONSTRAINT "CHK_catalog_metadata_revisions_rejection_reason" CHECK ("rejection_reason" IS NULL OR "rejection_reason" IN ('safety', 'publication_rights', 'duplicate_or_spam', 'technical_invalidity', 'quality_standard'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_catalog_metadata_revisions_account" ON "catalog"."catalog_metadata_revisions" ("account_id", "created_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_catalog_metadata_revisions_review_queue" ON "catalog"."catalog_metadata_revisions" ("status", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_catalog_metadata_revisions_pattern" ON "catalog"."catalog_metadata_revisions" ("community_pattern_id", "created_at" DESC)`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_catalog_metadata_revisions_active_slot"
      ON "catalog"."catalog_metadata_revisions" ("community_pattern_id")
      WHERE "status" IN ('pending', 'appeal_pending')
    `);

    await queryRunner.query(`
      CREATE TABLE "catalog"."catalog_metadata_appeals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "revision_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "note" varchar(1000),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_metadata_appeals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_catalog_metadata_appeals_revision" UNIQUE ("revision_id"),
        CONSTRAINT "FK_catalog_metadata_appeals_revision" FOREIGN KEY ("revision_id") REFERENCES "catalog"."catalog_metadata_revisions" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_metadata_appeals_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "catalog"."catalog_metadata_review_decisions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "revision_id" uuid NOT NULL,
        "review_round" varchar(16) NOT NULL,
        "decision" varchar(16) NOT NULL,
        "operator_account_id" uuid NOT NULL,
        "rejection_reason" varchar(32),
        "note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_metadata_review_decisions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_catalog_metadata_review_decisions_round" UNIQUE ("revision_id", "review_round"),
        CONSTRAINT "FK_catalog_metadata_review_decisions_revision" FOREIGN KEY ("revision_id") REFERENCES "catalog"."catalog_metadata_revisions" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_metadata_review_decisions_operator" FOREIGN KEY ("operator_account_id") REFERENCES "admin"."operator_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_catalog_metadata_review_decisions_round" CHECK ("review_round" IN ('initial', 'appeal')),
        CONSTRAINT "CHK_catalog_metadata_review_decisions_decision" CHECK ("decision" IN ('accepted', 'rejected')),
        CONSTRAINT "CHK_catalog_metadata_review_decisions_rejection" CHECK (("decision" = 'accepted' AND "rejection_reason" IS NULL) OR ("decision" = 'rejected' AND "rejection_reason" IN ('safety', 'publication_rights', 'duplicate_or_spam', 'technical_invalidity', 'quality_standard')))
      )
    `);

    await queryRunner.query(`
      CREATE FUNCTION "catalog"."reject_catalog_metadata_revision_snapshot_change"()
      RETURNS trigger AS $$
      BEGIN
        IF ROW(NEW."account_id", NEW."creator_profile_id", NEW."community_pattern_id", NEW."title", NEW."description", NEW."source_language", NEW."category_code", NEW."tag_codes")
          IS DISTINCT FROM
           ROW(OLD."account_id", OLD."creator_profile_id", OLD."community_pattern_id", OLD."title", OLD."description", OLD."source_language", OLD."category_code", OLD."tag_codes") THEN
          RAISE EXCEPTION 'Catalog Metadata Revision snapshot is immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_catalog_metadata_revision_snapshot_immutable"
      BEFORE UPDATE ON "catalog"."catalog_metadata_revisions"
      FOR EACH ROW EXECUTE FUNCTION "catalog"."reject_catalog_metadata_revision_snapshot_change"()
    `);

    await queryRunner.query(`
      CREATE TRIGGER "TR_catalog_metadata_appeals_append_only" BEFORE UPDATE OR DELETE ON "catalog"."catalog_metadata_appeals"
      FOR EACH ROW EXECUTE FUNCTION "catalog"."reject_catalog_review_history_mutation"()
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_catalog_metadata_review_decisions_append_only" BEFORE UPDATE OR DELETE ON "catalog"."catalog_metadata_review_decisions"
      FOR EACH ROW EXECUTE FUNCTION "catalog"."reject_catalog_review_history_mutation"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_catalog_metadata_review_decisions_append_only" ON "catalog"."catalog_metadata_review_decisions"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_catalog_metadata_appeals_append_only" ON "catalog"."catalog_metadata_appeals"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_catalog_metadata_revision_snapshot_immutable" ON "catalog"."catalog_metadata_revisions"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "catalog"."reject_catalog_metadata_revision_snapshot_change"()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "catalog"."catalog_metadata_review_decisions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "catalog"."catalog_metadata_appeals"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "catalog"."UQ_catalog_metadata_revisions_active_slot"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "catalog"."IDX_catalog_metadata_revisions_pattern"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "catalog"."IDX_catalog_metadata_revisions_review_queue"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "catalog"."IDX_catalog_metadata_revisions_account"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "catalog"."catalog_metadata_revisions"`);
  }
}
