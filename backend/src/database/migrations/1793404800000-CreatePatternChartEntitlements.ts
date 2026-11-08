import type { MigrationInterface, QueryRunner } from 'typeorm';

const PREVIOUS_REASONS = "'ad_reward', 'first_completion', 'unlock_spend', 'daily_task', 'guest_promotion', 'coin_pack_purchase', 'commerce_reversal', 'premium_daily_claim', 'commerce_transfer', 'locator_spend'";

/** Pattern Chart Entitlement table and the pattern_chart_spend ledger reason (ADR-0068, #287). */
export class CreatePatternChartEntitlements1793404800000 implements MigrationInterface {
  readonly name = 'CreatePatternChartEntitlements1793404800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "economy"."pattern_chart_entitlements" (
        "account_id" uuid NOT NULL,
        "pattern_id" uuid NOT NULL,
        "source" varchar(32) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pattern_chart_entitlements" PRIMARY KEY ("account_id", "pattern_id"),
        CONSTRAINT "CHK_pattern_chart_entitlements_source" CHECK ("source" IN ('completion', 'coin_spend', 'promotion', 'backfill'))
      )
    `);
    await queryRunner.query('ALTER TABLE "economy"."coin_ledger_entries" DROP CONSTRAINT "CHK_coin_ledger_entries_reason"');
    await queryRunner.query(`
      ALTER TABLE "economy"."coin_ledger_entries"
      ADD CONSTRAINT "CHK_coin_ledger_entries_reason"
      CHECK ("reason" IN (${PREVIOUS_REASONS}, 'pattern_chart_spend'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."pattern_chart_entitlements"');
    await queryRunner.query('DELETE FROM "economy"."coin_ledger_entries" WHERE "reason" = \'pattern_chart_spend\'');
    await queryRunner.query('ALTER TABLE "economy"."coin_ledger_entries" DROP CONSTRAINT "CHK_coin_ledger_entries_reason"');
    await queryRunner.query(`
      ALTER TABLE "economy"."coin_ledger_entries"
      ADD CONSTRAINT "CHK_coin_ledger_entries_reason"
      CHECK ("reason" IN (${PREVIOUS_REASONS}))
    `);
  }
}
