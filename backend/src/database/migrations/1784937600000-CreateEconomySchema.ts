import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEconomySchema1784937600000 implements MigrationInterface {
  readonly name = 'CreateEconomySchema1784937600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "economy"');

    // Stitch Coin balance per principal (guest installation or registered
    // account), mirroring the sessions principal model. bigint + signed so a
    // later commerce reversal (ADR-0012) can drive it negative without a schema
    // change; the ad-reward slice only ever increments it.
    await queryRunner.query(`
      CREATE TABLE "economy"."coin_balances" (
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "balance" bigint NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_coin_balances" PRIMARY KEY ("principal_type", "principal_id"),
        CONSTRAINT "CHK_coin_balances_principal_type" CHECK ("principal_type" IN ('guest', 'account'))
      )
    `);

    // Append-only journal of every coin movement. "source_key" is the
    // idempotency key (ad:<transaction_id> for rewarded ads); its UNIQUE
    // constraint collapses duplicate/replayed AdMob callbacks to one entry.
    // "granted" records whether the movement actually credited coin — a
    // rewarded ad received after the daily pool/limit is exhausted is recorded
    // with amount 0 and granted=false, so replays stay idempotent.
    await queryRunner.query(`
      CREATE TABLE "economy"."coin_ledger_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "amount" bigint NOT NULL,
        "reason" varchar(32) NOT NULL,
        "source_key" varchar(255) NOT NULL,
        "granted" boolean NOT NULL,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_coin_ledger_entries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_coin_ledger_entries_source_key" UNIQUE ("source_key"),
        CONSTRAINT "CHK_coin_ledger_entries_principal_type" CHECK ("principal_type" IN ('guest', 'account')),
        CONSTRAINT "CHK_coin_ledger_entries_reason" CHECK ("reason" IN ('ad_reward'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_coin_ledger_entries_principal"
      ON "economy"."coin_ledger_entries" ("principal_type", "principal_id", "created_at" DESC)
    `);

    // One row per principal per Reward Day (UTC calendar date). Encodes the
    // shared Ad-Equivalent Coin Pool: at most 30 coin and 3 rewarded ads per
    // day (ADR-0011). "premium_claimed" is reserved for the later Premium Daily
    // Coin Claim that draws the pool's unconsumed remainder.
    await queryRunner.query(`
      CREATE TABLE "economy"."reward_day_pools" (
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "reward_day" date NOT NULL,
        "coins_consumed" integer NOT NULL DEFAULT 0,
        "ads_completed" integer NOT NULL DEFAULT 0,
        "premium_claimed" boolean NOT NULL DEFAULT false,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reward_day_pools" PRIMARY KEY ("principal_type", "principal_id", "reward_day"),
        CONSTRAINT "CHK_reward_day_pools_principal_type" CHECK ("principal_type" IN ('guest', 'account')),
        CONSTRAINT "CHK_reward_day_pools_coins_consumed" CHECK ("coins_consumed" BETWEEN 0 AND 30),
        CONSTRAINT "CHK_reward_day_pools_ads_completed" CHECK ("ads_completed" BETWEEN 0 AND 3)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."reward_day_pools"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "economy"."IDX_coin_ledger_entries_principal"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "economy"."coin_ledger_entries"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."coin_balances"');
    await queryRunner.query('DROP SCHEMA IF EXISTS "economy"');
  }
}
