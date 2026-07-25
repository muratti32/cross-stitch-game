import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccountDeletion1786924800000 implements MigrationInterface {
  readonly name = 'CreateAccountDeletion1786924800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "deletion"');

    await queryRunner.query(`
      CREATE TABLE "deletion"."account_deletion_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "recovery_window_ends_at" timestamptz NOT NULL,
        "cancelled_at" timestamptz,
        "finalized_at" timestamptz,
        CONSTRAINT "PK_account_deletion_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_account_deletion_requests_account"
          FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_account_deletion_requests_status"
          CHECK ("status" IN ('pending', 'cancelled', 'finalized'))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_account_deletion_requests_pending"
      ON "deletion"."account_deletion_requests" ("account_id")
      WHERE "status" = 'pending'
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_account_deletion_requests_status_ends_at"
      ON "deletion"."account_deletion_requests" ("status", "recovery_window_ends_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "deletion"."deletion_audit_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "request_id" uuid NOT NULL,
        "event" varchar(48) NOT NULL,
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT "PK_deletion_audit_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_deletion_audit_events_request"
          FOREIGN KEY ("request_id") REFERENCES "deletion"."account_deletion_requests" ("id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_deletion_audit_events_request_occurred"
      ON "deletion"."deletion_audit_events" ("request_id", "occurred_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "auth"."registered_accounts"
      DROP CONSTRAINT "CHK_registered_accounts_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "auth"."registered_accounts"
      ADD CONSTRAINT "CHK_registered_accounts_status"
      CHECK ("status" IN ('active', 'closed', 'closing', 'deleted'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auth"."registered_accounts"
      DROP CONSTRAINT "CHK_registered_accounts_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "auth"."registered_accounts"
      ADD CONSTRAINT "CHK_registered_accounts_status"
      CHECK ("status" IN ('active', 'closed'))
    `);

    await queryRunner.query('DROP TABLE IF EXISTS "deletion"."deletion_audit_events"');
    await queryRunner.query('DROP TABLE IF EXISTS "deletion"."account_deletion_requests"');
    await queryRunner.query('DROP SCHEMA IF EXISTS "deletion"');
  }
}
