import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create pattern_unlocks table and widen coin ledger reason check to allow
 * pattern unlocks (ADR-0011).
 */
export class CreatePatternUnlocks1785110400000 implements MigrationInterface {
  readonly name = 'CreatePatternUnlocks1785110400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "economy"."pattern_unlocks" (
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "pattern_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pattern_unlocks" PRIMARY KEY ("principal_type", "principal_id", "pattern_id"),
        CONSTRAINT "CHK_pattern_unlocks_principal_type" CHECK ("principal_type" IN ('guest', 'account'))
      )`
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

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE "economy"."pattern_unlocks"`
    );

    await queryRunner.query(
      `DELETE FROM "economy"."coin_ledger_entries"
         WHERE "reason" = 'unlock_spend'`
    );
    await queryRunner.query(
      `ALTER TABLE "economy"."coin_ledger_entries"
         DROP CONSTRAINT "CHK_coin_ledger_entries_reason"`
    );
    await queryRunner.query(
      `ALTER TABLE "economy"."coin_ledger_entries"
         ADD CONSTRAINT "CHK_coin_ledger_entries_reason"
         CHECK ("reason" IN ('ad_reward', 'first_completion'))`
    );
  }
}
