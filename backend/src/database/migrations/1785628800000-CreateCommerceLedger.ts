import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCommerceLedger1785628800000 implements MigrationInterface {
  readonly name = 'CreateCommerceLedger1785628800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Widen CHK_coin_ledger_entries_reason on economy.coin_ledger_entries
    await queryRunner.query(`
      ALTER TABLE "economy"."coin_ledger_entries"
      DROP CONSTRAINT "CHK_coin_ledger_entries_reason"
    `);

    await queryRunner.query(`
      ALTER TABLE "economy"."coin_ledger_entries"
      ADD CONSTRAINT "CHK_coin_ledger_entries_reason"
      CHECK ("reason" IN (
        'ad_reward', 'first_completion', 'unlock_spend', 'daily_task', 'guest_promotion',
        'coin_pack_purchase', 'commerce_reversal'
      ))
    `);

    // 2. CREATE TABLE economy.ai_credit_balances
    await queryRunner.query(`
      CREATE TABLE "economy"."ai_credit_balances" (
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "balance" bigint NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_credit_balances" PRIMARY KEY ("principal_type", "principal_id"),
        CONSTRAINT "CHK_ai_credit_balances_principal_type" CHECK ("principal_type" IN ('guest', 'account'))
      )
    `);

    // 3. CREATE TABLE economy.ai_credit_ledger_entries
    await queryRunner.query(`
      CREATE TABLE "economy"."ai_credit_ledger_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "amount" bigint NOT NULL,
        "reason" varchar(32) NOT NULL,
        "source_key" varchar(255) NOT NULL,
        "granted" boolean NOT NULL,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_credit_ledger_entries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_credit_ledger_entries_source_key" UNIQUE ("source_key"),
        CONSTRAINT "CHK_ai_credit_ledger_entries_principal_type" CHECK ("principal_type" IN ('guest', 'account')),
        CONSTRAINT "CHK_ai_credit_ledger_entries_reason" CHECK ("reason" IN ('pack_purchase', 'commerce_reversal'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_ai_credit_ledger_entries_principal"
      ON "economy"."ai_credit_ledger_entries" ("principal_type", "principal_id", "created_at" DESC)
    `);

    // 4. CREATE TABLE economy.commerce_transaction_bindings
    await queryRunner.query(`
      CREATE TABLE "economy"."commerce_transaction_bindings" (
        "environment" varchar(16) NOT NULL,
        "provider_transaction_id" varchar(255) NOT NULL,
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "product_id" varchar(64) NOT NULL,
        "currency" varchar(16) NOT NULL,
        "granted_amount" bigint NOT NULL,
        "reversed_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_commerce_transaction_bindings" PRIMARY KEY ("environment", "provider_transaction_id"),
        CONSTRAINT "CHK_commerce_transaction_bindings_environment" CHECK ("environment" IN ('sandbox', 'production')),
        CONSTRAINT "CHK_commerce_transaction_bindings_principal_type" CHECK ("principal_type" = 'account'),
        CONSTRAINT "CHK_commerce_transaction_bindings_currency" CHECK ("currency" IN ('coin', 'ai_credit'))
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop commerce_transaction_bindings table
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."commerce_transaction_bindings"');

    // 2. Drop ai_credit_ledger_entries index and table
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."IDX_ai_credit_ledger_entries_principal"');
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."ai_credit_ledger_entries"');

    // 3. Drop ai_credit_balances table
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."ai_credit_balances"');

    // 4. Clean up coin ledger entries for coin pack purchase and commerce reversals
    await queryRunner.query(`
      DELETE FROM "economy"."coin_ledger_entries"
      WHERE "reason" IN ('coin_pack_purchase', 'commerce_reversal')
    `);

    // 5. Revert CHK_coin_ledger_entries_reason check constraint
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
}
