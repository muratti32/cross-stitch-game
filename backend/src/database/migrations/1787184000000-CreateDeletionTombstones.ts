import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDeletionTombstones1787184000000
  implements MigrationInterface
{
  readonly name = 'CreateDeletionTombstones1787184000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add deleted_at column to creator_profiles
    await queryRunner.query(`
      ALTER TABLE "moderation"."creator_profiles"
      ADD COLUMN "deleted_at" timestamptz
    `);

    // 2. Create provider_job_tombstones table
    await queryRunner.query(`
      CREATE TABLE "deletion"."provider_job_tombstones" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "provider" varchar(32) NOT NULL,
        "provider_request_id" varchar(128) NOT NULL,
        "processing_job_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_provider_job_tombstones" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_provider_job_tombstones_provider_request" UNIQUE ("provider", "provider_request_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_provider_job_tombstones_processing_job_id"
      ON "deletion"."provider_job_tombstones" ("processing_job_id")
    `);

    // 3. Widen moderation.creator_profile_appeals so finalization can close a
    // pending appeal as 'dismissed'. Guarded on the table existing, because
    // narrow integration harnesses run this migration list without the
    // moderation appeal schema.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('"moderation"."creator_profile_appeals"') IS NULL THEN
          RETURN;
        END IF;

        ALTER TABLE "moderation"."creator_profile_appeals"
          DROP CONSTRAINT "CHK_creator_profile_appeals_status";
        ALTER TABLE "moderation"."creator_profile_appeals"
          ADD CONSTRAINT "CHK_creator_profile_appeals_status"
          CHECK ("status" IN ('open', 'accepted', 'upheld', 'dismissed'));

        ALTER TABLE "moderation"."creator_profile_appeals"
          DROP CONSTRAINT "CHK_creator_profile_appeals_decided";
        ALTER TABLE "moderation"."creator_profile_appeals"
          ADD CONSTRAINT "CHK_creator_profile_appeals_decided"
          CHECK (
            ("status" = 'open' AND "decided_at" IS NULL AND "decided_by" IS NULL AND "reason" IS NULL)
            OR
            ("status" IN ('accepted', 'upheld') AND "decided_at" IS NOT NULL AND "decided_by" IS NOT NULL AND "reason" IS NOT NULL)
            OR
            ("status" = 'dismissed' AND "decided_at" IS NULL AND "decided_by" IS NULL AND "reason" IS NULL)
          );
      END
      $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // 3. Restore creator_profile_appeals constraints, dropping the appeals that
    // finalization closed as 'dismissed' because the old constraint rejects them.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('"moderation"."creator_profile_appeals"') IS NULL THEN
          RETURN;
        END IF;

        DELETE FROM "moderation"."creator_profile_appeals" WHERE "status" = 'dismissed';

        ALTER TABLE "moderation"."creator_profile_appeals"
          DROP CONSTRAINT "CHK_creator_profile_appeals_decided";
        ALTER TABLE "moderation"."creator_profile_appeals"
          ADD CONSTRAINT "CHK_creator_profile_appeals_decided"
          CHECK (
            ("status" = 'open' AND "decided_at" IS NULL AND "decided_by" IS NULL AND "reason" IS NULL)
            OR
            ("status" IN ('accepted', 'upheld') AND "decided_at" IS NOT NULL AND "decided_by" IS NOT NULL AND "reason" IS NOT NULL)
          );

        ALTER TABLE "moderation"."creator_profile_appeals"
          DROP CONSTRAINT "CHK_creator_profile_appeals_status";
        ALTER TABLE "moderation"."creator_profile_appeals"
          ADD CONSTRAINT "CHK_creator_profile_appeals_status"
          CHECK ("status" IN ('open', 'accepted', 'upheld'));
      END
      $$;
    `);

    // 2. Drop provider_job_tombstones
    await queryRunner.query(`
      DROP TABLE IF EXISTS "deletion"."provider_job_tombstones"
    `);

    // 1. Remove deleted_at column from creator_profiles
    await queryRunner.query(`
      ALTER TABLE "moderation"."creator_profiles"
      DROP COLUMN "deleted_at"
    `);
  }
}
