import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReviewHolds1787875200000 implements MigrationInterface {
  readonly name = 'CreateReviewHolds1787875200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "catalog"."patterns"
      DROP CONSTRAINT "CHK_patterns_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "catalog"."patterns"
      ADD CONSTRAINT "CHK_patterns_status"
      CHECK ("status" IN ('available', 'review_hold', 'withdrawn', 'removed'))
    `);

    await queryRunner.query(`
      ALTER TABLE "moderation"."post_publication_reviews"
      ADD COLUMN "hold_applied_at" timestamptz,
      ADD COLUMN "hold_reason" varchar(2000),
      ADD COLUMN "hold_operator_account_id" uuid,
      ADD CONSTRAINT "FK_post_publication_reviews_hold_operator"
        FOREIGN KEY ("hold_operator_account_id")
        REFERENCES "admin"."operator_accounts" ("id") ON DELETE RESTRICT,
      ADD CONSTRAINT "CHK_post_publication_reviews_hold"
        CHECK (
          ("hold_applied_at" IS NULL AND "hold_reason" IS NULL AND "hold_operator_account_id" IS NULL)
          OR
          ("hold_applied_at" IS NOT NULL AND length(btrim("hold_reason")) > 0 AND "hold_operator_account_id" IS NOT NULL)
        )
    `);

    await queryRunner.query(`
      CREATE TABLE "moderation"."moderation_notices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "community_pattern_id" uuid NOT NULL,
        "review_id" uuid NOT NULL,
        "notice_type" varchar(32) NOT NULL,
        "pattern_title" varchar(255) NOT NULL,
        "reason" varchar(2000) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_moderation_notices" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_moderation_notices_review_type" UNIQUE ("review_id", "notice_type"),
        CONSTRAINT "FK_moderation_notices_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_moderation_notices_pattern" FOREIGN KEY ("community_pattern_id") REFERENCES "catalog"."patterns" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_moderation_notices_review" FOREIGN KEY ("review_id") REFERENCES "moderation"."post_publication_reviews" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_moderation_notices_type" CHECK ("notice_type" IN ('review_hold')),
        CONSTRAINT "CHK_moderation_notices_reason" CHECK (length(btrim("reason")) > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_moderation_notices_account_created"
      ON "moderation"."moderation_notices" ("account_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_moderation_notices_append_only"
      BEFORE UPDATE OR DELETE ON "moderation"."moderation_notices"
      FOR EACH ROW EXECUTE FUNCTION "catalog"."reject_catalog_review_history_mutation"()
    `);

    await queryRunner.query(`
      ALTER TABLE "notifications"."email_outbox"
      DROP CONSTRAINT "CHK_email_outbox_template"
    `);
    await queryRunner.query(`
      ALTER TABLE "notifications"."email_outbox"
      ADD CONSTRAINT "CHK_email_outbox_template"
      CHECK ("template" IN ('email_otp', 'moderation_notice'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "notifications"."email_outbox" DROP CONSTRAINT "CHK_email_outbox_template"`);
    await queryRunner.query(`ALTER TABLE "notifications"."email_outbox" ADD CONSTRAINT "CHK_email_outbox_template" CHECK ("template" = 'email_otp')`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "TR_moderation_notices_append_only" ON "moderation"."moderation_notices"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "moderation"."IDX_moderation_notices_account_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "moderation"."moderation_notices"`);
    await queryRunner.query(`ALTER TABLE "moderation"."post_publication_reviews" DROP CONSTRAINT "CHK_post_publication_reviews_hold"`);
    await queryRunner.query(`ALTER TABLE "moderation"."post_publication_reviews" DROP CONSTRAINT "FK_post_publication_reviews_hold_operator"`);
    await queryRunner.query(`ALTER TABLE "moderation"."post_publication_reviews" DROP COLUMN "hold_operator_account_id", DROP COLUMN "hold_reason", DROP COLUMN "hold_applied_at"`);
    await queryRunner.query(`ALTER TABLE "catalog"."patterns" DROP CONSTRAINT "CHK_patterns_status"`);
    await queryRunner.query(`ALTER TABLE "catalog"."patterns" ADD CONSTRAINT "CHK_patterns_status" CHECK ("status" IN ('available', 'withdrawn', 'removed'))`);
  }
}
