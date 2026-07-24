import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCommunityReports1786320000000 implements MigrationInterface {
  readonly name = 'CreateCommunityReports1786320000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "moderation"."post_publication_reviews" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "community_pattern_id" uuid NOT NULL,
        "metadata_revision_id" uuid,
        "status" varchar(16) NOT NULL DEFAULT 'open',
        "closed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_post_publication_reviews" PRIMARY KEY ("id"),
        CONSTRAINT "FK_post_publication_reviews_pattern" FOREIGN KEY ("community_pattern_id") REFERENCES "catalog"."patterns" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_post_publication_reviews_metadata_revision" FOREIGN KEY ("metadata_revision_id") REFERENCES "catalog"."catalog_metadata_revisions" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_post_publication_reviews_status" CHECK ("status" IN ('open', 'closed')),
        CONSTRAINT "CHK_post_publication_reviews_closed_at" CHECK (("status" = 'open' AND "closed_at" IS NULL) OR ("status" = 'closed' AND "closed_at" IS NOT NULL))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_post_publication_reviews_pattern" ON "moderation"."post_publication_reviews" ("community_pattern_id", "created_at" DESC)`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_post_publication_reviews_open_pattern" ON "moderation"."post_publication_reviews" ("community_pattern_id") WHERE "status" = 'open'`);

    await queryRunner.query(`
      CREATE TABLE "moderation"."community_reports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "review_id" uuid NOT NULL,
        "reporter_account_id" uuid NOT NULL,
        "reason" varchar(64) NOT NULL,
        "explanation" varchar(2000),
        "evidence_digest" char(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_community_reports" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_community_reports_review_reporter" UNIQUE ("review_id", "reporter_account_id"),
        CONSTRAINT "FK_community_reports_review" FOREIGN KEY ("review_id") REFERENCES "moderation"."post_publication_reviews" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_community_reports_reporter" FOREIGN KEY ("reporter_account_id") REFERENCES "auth"."registered_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_community_reports_reason" CHECK ("reason" IN ('inappropriate_or_unsafe_content', 'copyright_or_publication_rights', 'duplicate_or_spam', 'misleading_title_or_tags', 'other')),
        CONSTRAINT "CHK_community_reports_other_explanation" CHECK ("reason" <> 'other' OR ("explanation" IS NOT NULL AND length(btrim("explanation")) > 0)),
        CONSTRAINT "CHK_community_reports_evidence_digest" CHECK (("explanation" IS NULL AND "evidence_digest" IS NULL) OR ("explanation" IS NOT NULL AND "evidence_digest" IS NOT NULL))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_community_reports_reporter_created" ON "moderation"."community_reports" ("reporter_account_id", "created_at" DESC)`);
    await queryRunner.query(`
      CREATE TRIGGER "TR_community_reports_append_only"
      BEFORE UPDATE OR DELETE ON "moderation"."community_reports"
      FOR EACH ROW EXECUTE FUNCTION "catalog"."reject_catalog_review_history_mutation"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_community_reports_append_only" ON "moderation"."community_reports"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "moderation"."IDX_community_reports_reporter_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "moderation"."community_reports"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "moderation"."UQ_post_publication_reviews_open_pattern"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "moderation"."IDX_post_publication_reviews_pattern"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "moderation"."post_publication_reviews"`);
  }
}
