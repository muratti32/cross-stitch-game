import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSafetyRemovalAppeals1786752000000 implements MigrationInterface {
  readonly name = 'CreateSafetyRemovalAppeals1786752000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "moderation"."safety_removal_appeals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "review_id" uuid NOT NULL,
        "community_pattern_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "note" varchar(1000),
        "status" varchar(16) NOT NULL DEFAULT 'open',
        "excluded_operator_account_id" uuid NOT NULL,
        "decided_at" timestamptz,
        "decision_operator_account_id" uuid,
        "decision_reason" varchar(2000),
        "same_moderator_fallback" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_safety_removal_appeals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_safety_removal_appeals_review" UNIQUE ("review_id"),
        CONSTRAINT "FK_safety_removal_appeals_review" FOREIGN KEY ("review_id") REFERENCES "moderation"."post_publication_reviews" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_safety_removal_appeals_pattern" FOREIGN KEY ("community_pattern_id") REFERENCES "catalog"."patterns" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_safety_removal_appeals_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_safety_removal_appeals_excluded_operator" FOREIGN KEY ("excluded_operator_account_id") REFERENCES "admin"."operator_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_safety_removal_appeals_decision_operator" FOREIGN KEY ("decision_operator_account_id") REFERENCES "admin"."operator_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_safety_removal_appeals_status" CHECK ("status" IN ('open', 'accepted', 'rejected')),
        CONSTRAINT "CHK_safety_removal_appeals_decision" CHECK (
          ("status" = 'open' AND "decided_at" IS NULL AND "decision_operator_account_id" IS NULL AND "decision_reason" IS NULL AND "same_moderator_fallback" = false)
          OR
          ("status" IN ('accepted', 'rejected') AND "decided_at" IS NOT NULL AND "decision_operator_account_id" IS NOT NULL AND length(btrim("decision_reason")) > 0)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_safety_removal_appeals_pattern"
      ON "moderation"."safety_removal_appeals" ("community_pattern_id", "created_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "moderation"."moderation_notices"
      DROP CONSTRAINT "CHK_moderation_notices_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "moderation"."moderation_notices"
      ADD CONSTRAINT "CHK_moderation_notices_type"
      CHECK ("notice_type" IN ('review_hold', 'no_violation', 'metadata_remediation', 'safety_removal', 'safety_removal_appeal_accepted', 'safety_removal_appeal_rejected'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "moderation"."moderation_notices"
      DROP CONSTRAINT "CHK_moderation_notices_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "moderation"."moderation_notices"
      ADD CONSTRAINT "CHK_moderation_notices_type"
      CHECK ("notice_type" IN ('review_hold', 'no_violation', 'metadata_remediation', 'safety_removal'))
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "moderation"."IDX_safety_removal_appeals_pattern"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "moderation"."safety_removal_appeals"`);
  }
}
