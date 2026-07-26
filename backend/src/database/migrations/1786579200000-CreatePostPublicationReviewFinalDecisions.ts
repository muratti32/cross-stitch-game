import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePostPublicationReviewFinalDecisions1786579200000
  implements MigrationInterface
{
  readonly name = 'CreatePostPublicationReviewFinalDecisions1786579200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "moderation"."post_publication_reviews"
      ADD COLUMN "close_outcome" varchar(32),
      ADD COLUMN "close_reason" varchar(2000),
      ADD COLUMN "close_operator_account_id" uuid,
      ADD CONSTRAINT "FK_post_publication_reviews_close_operator"
        FOREIGN KEY ("close_operator_account_id")
        REFERENCES "admin"."operator_accounts" ("id") ON DELETE RESTRICT,
      ADD CONSTRAINT "CHK_post_publication_reviews_close_outcome"
        CHECK ("close_outcome" IN ('no_violation', 'metadata_remediation')),
      ADD CONSTRAINT "CHK_post_publication_reviews_close"
        CHECK (
          ("status" = 'open' AND "close_outcome" IS NULL AND "close_reason" IS NULL AND "close_operator_account_id" IS NULL)
          OR
          ("status" = 'closed' AND "close_outcome" IS NOT NULL AND length(btrim("close_reason")) > 0 AND "close_operator_account_id" IS NOT NULL)
        )
    `);

    await queryRunner.query(`
      CREATE TABLE "moderation"."post_publication_review_closures" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "review_id" uuid NOT NULL,
        "record_type" varchar(32) NOT NULL,
        "record_id" uuid NOT NULL,
        "from_status" varchar(32) NOT NULL,
        "to_status" varchar(32) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_post_publication_review_closures" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_post_publication_review_closures_record" UNIQUE ("review_id", "record_type", "record_id"),
        CONSTRAINT "FK_post_publication_review_closures_review" FOREIGN KEY ("review_id") REFERENCES "moderation"."post_publication_reviews" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_post_publication_review_closures_record_type" CHECK ("record_type" IN ('metadata_revision', 'metadata_appeal'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_post_publication_review_closures_review"
      ON "moderation"."post_publication_review_closures" ("review_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_post_publication_review_closures_append_only"
      BEFORE UPDATE OR DELETE ON "moderation"."post_publication_review_closures"
      FOR EACH ROW EXECUTE FUNCTION "catalog"."reject_catalog_review_history_mutation"()
    `);

    await queryRunner.query(`
      ALTER TABLE "moderation"."moderation_notices"
      DROP CONSTRAINT "CHK_moderation_notices_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "moderation"."moderation_notices"
      ADD CONSTRAINT "CHK_moderation_notices_type"
      CHECK ("notice_type" IN ('review_hold', 'no_violation', 'metadata_remediation'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "moderation"."moderation_notices" DROP CONSTRAINT "CHK_moderation_notices_type"`);
    await queryRunner.query(`ALTER TABLE "moderation"."moderation_notices" ADD CONSTRAINT "CHK_moderation_notices_type" CHECK ("notice_type" IN ('review_hold'))`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_post_publication_review_closures_append_only" ON "moderation"."post_publication_review_closures"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "moderation"."IDX_post_publication_review_closures_review"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "moderation"."post_publication_review_closures"`);
    await queryRunner.query(`ALTER TABLE "moderation"."post_publication_reviews" DROP CONSTRAINT "CHK_post_publication_reviews_close"`);
    await queryRunner.query(`ALTER TABLE "moderation"."post_publication_reviews" DROP CONSTRAINT "CHK_post_publication_reviews_close_outcome"`);
    await queryRunner.query(`ALTER TABLE "moderation"."post_publication_reviews" DROP CONSTRAINT "FK_post_publication_reviews_close_operator"`);
    await queryRunner.query(`ALTER TABLE "moderation"."post_publication_reviews" DROP COLUMN "close_operator_account_id", DROP COLUMN "close_reason", DROP COLUMN "close_outcome"`);
  }
}
