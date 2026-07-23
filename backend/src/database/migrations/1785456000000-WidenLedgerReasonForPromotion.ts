import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenLedgerReasonForPromotion1785456000000 implements MigrationInterface {
  readonly name = 'WidenLedgerReasonForPromotion1785456000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "economy"."coin_ledger_entries"
      DROP CONSTRAINT "CHK_coin_ledger_entries_reason"
    `);

    await queryRunner.query(`
      ALTER TABLE "economy"."coin_ledger_entries"
      ADD CONSTRAINT "CHK_coin_ledger_entries_reason"
      CHECK ("reason" IN ('ad_reward', 'first_completion', 'unlock_spend', 'daily_task', 'guest_promotion'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "economy"."coin_ledger_entries"
      DROP CONSTRAINT "CHK_coin_ledger_entries_reason"
    `);

    await queryRunner.query(`
      ALTER TABLE "economy"."coin_ledger_entries"
      ADD CONSTRAINT "CHK_coin_ledger_entries_reason"
      CHECK ("reason" IN ('ad_reward', 'first_completion', 'unlock_spend', 'daily_task'))
    `);
  }
}
