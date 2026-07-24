import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCreatorProfileAppeals1786665600000
  implements MigrationInterface
{
  readonly name = 'CreateCreatorProfileAppeals1786665600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // One Creator Restriction Appeal per restricting Profile Investigation
    // (unique below): the restriction stays fully in effect until this
    // resolves, and an upheld outcome is final because a second appeal can
    // never be filed against the same investigation.
    await queryRunner.query(`
      CREATE TABLE "moderation"."creator_profile_appeals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "profile_id" uuid NOT NULL,
        "investigation_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "restricting_operator_id" uuid,
        "assigned_operator_id" uuid,
        "status" varchar(16) NOT NULL DEFAULT 'open',
        "note" varchar(1000),
        "decided_by" uuid,
        "decided_at" timestamptz,
        "reason" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_creator_profile_appeals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_creator_profile_appeals_investigation" UNIQUE ("investigation_id"),
        CONSTRAINT "FK_creator_profile_appeals_profile"
          FOREIGN KEY ("profile_id") REFERENCES "moderation"."creator_profiles" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_creator_profile_appeals_investigation"
          FOREIGN KEY ("investigation_id") REFERENCES "moderation"."profile_investigations" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_creator_profile_appeals_account"
          FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_creator_profile_appeals_restricting_operator"
          FOREIGN KEY ("restricting_operator_id") REFERENCES "admin"."operator_accounts" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_creator_profile_appeals_assigned_operator"
          FOREIGN KEY ("assigned_operator_id") REFERENCES "admin"."operator_accounts" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_creator_profile_appeals_decided_by"
          FOREIGN KEY ("decided_by") REFERENCES "admin"."operator_accounts" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_creator_profile_appeals_status"
          CHECK ("status" IN ('open', 'accepted', 'upheld')),
        CONSTRAINT "CHK_creator_profile_appeals_decided"
          CHECK (
            ("status" = 'open' AND "decided_at" IS NULL AND "decided_by" IS NULL AND "reason" IS NULL)
            OR
            ("status" IN ('accepted', 'upheld') AND "decided_at" IS NOT NULL AND "decided_by" IS NOT NULL AND "reason" IS NOT NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_creator_profile_appeals_profile"
      ON "moderation"."creator_profile_appeals" ("profile_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_creator_profile_appeals_queue"
      ON "moderation"."creator_profile_appeals" ("status", "created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "moderation"."creator_profile_appeals"',
    );
  }
}
