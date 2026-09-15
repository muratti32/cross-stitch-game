import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLocatorAttempts1792713600000 implements MigrationInterface {
  readonly name = 'CreateLocatorAttempts1792713600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "economy"."locator_attempts" (
        "attempt_id" uuid NOT NULL,
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "session_id" uuid NOT NULL,
        "pattern_id" uuid NOT NULL,
        "color_index" integer NOT NULL,
        "dmc_code" varchar(16) NOT NULL,
        "target_cell_index" integer,
        "progress_revision" bigint,
        "progress_hash" varchar(128),
        "reserved_paid_amount" bigint NOT NULL DEFAULT 0,
        "status" varchar(16) NOT NULL DEFAULT 'prepared',
        "reserved_until" timestamptz NOT NULL,
        "terminal_at" timestamptz,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_locator_attempts" PRIMARY KEY ("attempt_id"),
        CONSTRAINT "CHK_locator_attempts_principal_type" CHECK ("principal_type" IN ('guest', 'account')),
        CONSTRAINT "CHK_locator_attempts_status" CHECK ("status" IN ('prepared', 'committed', 'released', 'expired', 'rejected'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_locator_attempts_principal_session"
      ON "economy"."locator_attempts" ("principal_type", "principal_id", "session_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_locator_attempts_one_prepared"
      ON "economy"."locator_attempts" ("principal_type", "principal_id", "session_id")
      WHERE "status" = 'prepared'
    `);
    await queryRunner.query(`
      ALTER TABLE "economy"."coin_ledger_entries"
      DROP CONSTRAINT "CHK_coin_ledger_entries_reason"
    `);
    await queryRunner.query(`
      ALTER TABLE "economy"."coin_ledger_entries"
      ADD CONSTRAINT "CHK_coin_ledger_entries_reason"
      CHECK ("reason" IN ('ad_reward', 'first_completion', 'unlock_spend', 'daily_task', 'guest_promotion', 'coin_pack_purchase', 'commerce_reversal', 'premium_daily_claim', 'commerce_transfer', 'locator_spend'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."UQ_locator_attempts_one_prepared"');
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."IDX_locator_attempts_principal_session"');
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."locator_attempts"');
    await queryRunner.query('ALTER TABLE "economy"."coin_ledger_entries" DROP CONSTRAINT "CHK_coin_ledger_entries_reason"');
    await queryRunner.query(`
      ALTER TABLE "economy"."coin_ledger_entries"
      ADD CONSTRAINT "CHK_coin_ledger_entries_reason"
      CHECK ("reason" IN ('ad_reward', 'first_completion', 'unlock_spend', 'daily_task', 'guest_promotion', 'coin_pack_purchase', 'commerce_reversal', 'premium_daily_claim', 'commerce_transfer'))
    `);
  }
}
