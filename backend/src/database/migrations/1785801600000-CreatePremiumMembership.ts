import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePremiumMembership1785801600000 implements MigrationInterface {
  readonly name = 'CreatePremiumMembership1785801600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "economy"."coin_ledger_entries"
      DROP CONSTRAINT "CHK_coin_ledger_entries_reason"
    `);
    await queryRunner.query(`
      ALTER TABLE "economy"."coin_ledger_entries"
      ADD CONSTRAINT "CHK_coin_ledger_entries_reason"
      CHECK ("reason" IN (
        'ad_reward', 'first_completion', 'unlock_spend', 'daily_task', 'guest_promotion',
        'coin_pack_purchase', 'commerce_reversal', 'premium_daily_claim'
      ))
    `);

    await queryRunner.query(`
      ALTER TABLE "economy"."ai_credit_ledger_entries"
      DROP CONSTRAINT "CHK_ai_credit_ledger_entries_reason"
    `);
    await queryRunner.query(`
      ALTER TABLE "economy"."ai_credit_ledger_entries"
      ADD CONSTRAINT "CHK_ai_credit_ledger_entries_reason"
      CHECK ("reason" IN (
        'pack_purchase', 'commerce_reversal', 'membership_credit_grant', 'membership_reversal'
      ))
    `);

    await queryRunner.query(`
      CREATE TABLE "economy"."membership_events" (
        "environment" varchar(16) NOT NULL,
        "provider_event_id" varchar(255) NOT NULL,
        "provider_transaction_id" varchar(255) NOT NULL,
        "original_transaction_id" varchar(255) NOT NULL,
        "account_id" uuid NOT NULL,
        "event_type" varchar(48) NOT NULL,
        "product_id" varchar(255) NOT NULL,
        "period_type" varchar(24) NOT NULL,
        "event_at" timestamptz NOT NULL,
        "purchased_at" timestamptz NOT NULL,
        "expires_at" timestamptz NULL,
        "grace_period_expires_at" timestamptz NULL,
        "cancel_reason" varchar(48) NULL,
        "received_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_membership_events" PRIMARY KEY ("environment", "provider_event_id"),
        CONSTRAINT "CHK_membership_events_environment" CHECK ("environment" IN ('sandbox', 'production'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_membership_events_period_history"
      ON "economy"."membership_events"
        ("environment", "provider_transaction_id", "event_at", "provider_event_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_membership_events_account_history"
      ON "economy"."membership_events" ("account_id", "event_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "economy"."membership_periods" (
        "environment" varchar(16) NOT NULL,
        "provider_transaction_id" varchar(255) NOT NULL,
        "original_transaction_id" varchar(255) NOT NULL,
        "account_id" uuid NOT NULL,
        "product_id" varchar(255) NOT NULL,
        "plan" varchar(16) NOT NULL,
        "period_type" varchar(24) NOT NULL,
        "starts_at" timestamptz NOT NULL,
        "ends_at" timestamptz NULL,
        "current_status" varchar(32) NOT NULL,
        "status_event_at" timestamptz NOT NULL,
        "credit_amount" integer NOT NULL DEFAULT 0,
        "credit_granted_at" timestamptz NULL,
        "reversed_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_membership_periods" PRIMARY KEY ("environment", "provider_transaction_id"),
        CONSTRAINT "CHK_membership_periods_environment" CHECK ("environment" IN ('sandbox', 'production')),
        CONSTRAINT "CHK_membership_periods_plan" CHECK ("plan" IN ('weekly', 'monthly', 'annual')),
        CONSTRAINT "CHK_membership_periods_status" CHECK ("current_status" IN (
          'trial', 'active', 'cancelled', 'grace', 'billing_retry', 'paused', 'expired', 'refunded'
        )),
        CONSTRAINT "CHK_membership_periods_credit_amount" CHECK ("credit_amount" IN (0, 3, 15, 180))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_membership_periods_account_entitlement"
      ON "economy"."membership_periods" ("account_id", "ends_at" DESC, "status_event_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_membership_periods_original_transaction"
      ON "economy"."membership_periods" ("environment", "original_transaction_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."IDX_membership_periods_original_transaction"');
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."IDX_membership_periods_account_entitlement"');
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."membership_periods"');
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."IDX_membership_events_account_history"');
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."IDX_membership_events_period_history"');
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."membership_events"');

    await queryRunner.query(`
      DELETE FROM "economy"."coin_ledger_entries"
      WHERE "reason" = 'premium_daily_claim'
    `);
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

    await queryRunner.query(`
      DELETE FROM "economy"."ai_credit_ledger_entries"
      WHERE "reason" IN ('membership_credit_grant', 'membership_reversal')
    `);
    await queryRunner.query(`
      ALTER TABLE "economy"."ai_credit_ledger_entries"
      DROP CONSTRAINT "CHK_ai_credit_ledger_entries_reason"
    `);
    await queryRunner.query(`
      ALTER TABLE "economy"."ai_credit_ledger_entries"
      ADD CONSTRAINT "CHK_ai_credit_ledger_entries_reason"
      CHECK ("reason" IN ('pack_purchase', 'commerce_reversal'))
    `);
  }
}
