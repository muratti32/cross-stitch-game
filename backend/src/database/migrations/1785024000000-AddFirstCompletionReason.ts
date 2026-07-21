import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen the coin ledger reason check to allow the First Completion Reward
 * (ADR-0011). Every new earn/spend path lands its reason through a migration
 * like this so the append-only journal never accepts an unknown movement.
 */
export class AddFirstCompletionReason1785024000000
  implements MigrationInterface
{
  readonly name = 'AddFirstCompletionReason1785024000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "economy"."coin_ledger_entries"
         DROP CONSTRAINT "CHK_coin_ledger_entries_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "economy"."coin_ledger_entries"
         ADD CONSTRAINT "CHK_coin_ledger_entries_reason"
         CHECK ("reason" IN ('ad_reward', 'first_completion'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "economy"."coin_ledger_entries"
         WHERE "reason" = 'first_completion'`,
    );
    await queryRunner.query(
      `ALTER TABLE "economy"."coin_ledger_entries"
         DROP CONSTRAINT "CHK_coin_ledger_entries_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "economy"."coin_ledger_entries"
         ADD CONSTRAINT "CHK_coin_ledger_entries_reason"
         CHECK ("reason" IN ('ad_reward'))`,
    );
  }
}
