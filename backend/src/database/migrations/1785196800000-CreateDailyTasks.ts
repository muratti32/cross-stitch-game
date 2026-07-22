import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create gameplay_events and daily_color_action_counts tables, add index,
 * and widen coin ledger reason check to allow daily tasks.
 */
export class CreateDailyTasks1785196800000 implements MigrationInterface {
  readonly name = 'CreateDailyTasks1785196800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "economy"."gameplay_events" (
        "event_id" uuid NOT NULL,
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "reward_day" date NOT NULL,
        "kind" varchar(24) NOT NULL,
        "session_id" uuid NOT NULL,
        "dmc_code" varchar(16) NOT NULL,
        "client_seq" bigint NOT NULL,
        "occurred_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gameplay_events" PRIMARY KEY ("event_id"),
        CONSTRAINT "CHK_gameplay_events_principal_type" CHECK ("principal_type" IN ('guest', 'account')),
        CONSTRAINT "CHK_gameplay_events_kind" CHECK ("kind" IN ('stitch_action', 'color_completion'))
      )`
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_gameplay_events_principal_day" ON "economy"."gameplay_events" ("principal_type", "principal_id", "reward_day")`
    );

    await queryRunner.query(
      `CREATE TABLE "economy"."daily_color_action_counts" (
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "reward_day" date NOT NULL,
        "dmc_code" varchar(16) NOT NULL,
        "action_count" integer NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_daily_color_action_counts" PRIMARY KEY ("principal_type", "principal_id", "reward_day", "dmc_code"),
        CONSTRAINT "CHK_daily_color_action_counts_principal_type" CHECK ("principal_type" IN ('guest', 'account'))
      )`
    );

    await queryRunner.query(
      `ALTER TABLE "economy"."coin_ledger_entries"
         DROP CONSTRAINT "CHK_coin_ledger_entries_reason"`
    );

    await queryRunner.query(
      `ALTER TABLE "economy"."coin_ledger_entries"
         ADD CONSTRAINT "CHK_coin_ledger_entries_reason"
         CHECK ("reason" IN ('ad_reward', 'first_completion', 'unlock_spend', 'daily_task'))`
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "economy"."IDX_gameplay_events_principal_day"`
    );

    await queryRunner.query(
      `DROP TABLE "economy"."gameplay_events"`
    );

    await queryRunner.query(
      `DROP TABLE "economy"."daily_color_action_counts"`
    );

    await queryRunner.query(
      `DELETE FROM "economy"."coin_ledger_entries"
         WHERE "reason" = 'daily_task'`
    );

    await queryRunner.query(
      `ALTER TABLE "economy"."coin_ledger_entries"
         DROP CONSTRAINT "CHK_coin_ledger_entries_reason"`
    );

    await queryRunner.query(
      `ALTER TABLE "economy"."coin_ledger_entries"
         ADD CONSTRAINT "CHK_coin_ledger_entries_reason"
         CHECK ("reason" IN ('ad_reward', 'first_completion', 'unlock_spend'))`
    );
  }
}
