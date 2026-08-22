import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FixCommercePromotionOwnership1789344000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "promotion"."commerce_promotion_handoffs" ADD COLUMN "processing_job_id" uuid NULL`);
    await queryRunner.query(`ALTER TABLE "promotion"."commerce_promotion_handoffs" ADD CONSTRAINT "UQ_commerce_promotion_handoffs_processing_job" UNIQUE ("processing_job_id")`);
    await queryRunner.query(`ALTER TABLE "promotion"."commerce_promotion_handoffs" ADD CONSTRAINT "FK_commerce_promotion_handoffs_processing_job" FOREIGN KEY ("processing_job_id") REFERENCES "jobs"."processing_jobs"("id") ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE "economy"."revenuecat_subscriber_mappings" ALTER COLUMN "guest_installation_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "economy"."revenuecat_subscriber_mappings" ADD COLUMN "account_id" uuid NULL`);
    await queryRunner.query(`ALTER TABLE "economy"."revenuecat_subscriber_mappings" ADD CONSTRAINT "FK_revenuecat_subscriber_mappings_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "economy"."revenuecat_subscriber_mappings" ADD CONSTRAINT "CHK_revenuecat_subscriber_mappings_owner" CHECK (("guest_installation_id" IS NOT NULL AND "account_id" IS NULL) OR ("guest_installation_id" IS NULL AND "account_id" IS NOT NULL))`);
    await queryRunner.query(`ALTER TABLE "economy"."coin_ledger_entries" DROP CONSTRAINT "CHK_coin_ledger_entries_reason"`);
    await queryRunner.query(`ALTER TABLE "economy"."coin_ledger_entries" ADD CONSTRAINT "CHK_coin_ledger_entries_reason" CHECK ("reason" IN ('ad_reward','first_completion','unlock_spend','daily_task','guest_promotion','coin_pack_purchase','commerce_reversal','premium_daily_claim','commerce_transfer'))`);
    await queryRunner.query(`ALTER TABLE "economy"."ai_credit_ledger_entries" DROP CONSTRAINT "CHK_ai_credit_ledger_entries_reason"`);
    await queryRunner.query(`ALTER TABLE "economy"."ai_credit_ledger_entries" ADD CONSTRAINT "CHK_ai_credit_ledger_entries_reason" CHECK ("reason" IN ('pack_purchase','commerce_reversal','membership_credit_grant','membership_reversal','ai_artwork_delivery','commerce_transfer'))`);
    await queryRunner.query(`UPDATE economy.ai_credit_ledger_entries SET source_key = replace(source_key, 'membership:guest:', 'membership:') WHERE source_key LIKE 'membership:guest:%'`);
    await queryRunner.query(`UPDATE economy.ai_credit_ledger_entries SET source_key = replace(source_key, 'membership_reversal:guest:', 'membership_reversal:') WHERE source_key LIKE 'membership_reversal:guest:%'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "economy"."ai_credit_ledger_entries" DROP CONSTRAINT "CHK_ai_credit_ledger_entries_reason"`);
    await queryRunner.query(`ALTER TABLE "economy"."ai_credit_ledger_entries" ADD CONSTRAINT "CHK_ai_credit_ledger_entries_reason" CHECK ("reason" IN ('pack_purchase','commerce_reversal','membership_credit_grant','membership_reversal','ai_artwork_delivery'))`);
    await queryRunner.query(`ALTER TABLE "economy"."coin_ledger_entries" DROP CONSTRAINT "CHK_coin_ledger_entries_reason"`);
    await queryRunner.query(`ALTER TABLE "economy"."coin_ledger_entries" ADD CONSTRAINT "CHK_coin_ledger_entries_reason" CHECK ("reason" IN ('ad_reward','first_completion','unlock_spend','daily_task','guest_promotion','coin_pack_purchase','commerce_reversal','premium_daily_claim'))`);
    await queryRunner.query(`ALTER TABLE "economy"."revenuecat_subscriber_mappings" DROP CONSTRAINT "CHK_revenuecat_subscriber_mappings_owner"`);
    await queryRunner.query(`ALTER TABLE "economy"."revenuecat_subscriber_mappings" DROP CONSTRAINT "FK_revenuecat_subscriber_mappings_account"`);
    await queryRunner.query(`ALTER TABLE "economy"."revenuecat_subscriber_mappings" DROP COLUMN "account_id"`);
    await queryRunner.query(`ALTER TABLE "promotion"."commerce_promotion_handoffs" DROP CONSTRAINT "FK_commerce_promotion_handoffs_processing_job"`);
    await queryRunner.query(`ALTER TABLE "promotion"."commerce_promotion_handoffs" DROP CONSTRAINT "UQ_commerce_promotion_handoffs_processing_job"`);
    await queryRunner.query(`ALTER TABLE "promotion"."commerce_promotion_handoffs" DROP COLUMN "processing_job_id"`);
  }
}
