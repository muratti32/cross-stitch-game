import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiCreditPackPurchaseReconciliations1788652800000 implements MigrationInterface {
  readonly name = 'CreateAiCreditPackPurchaseReconciliations1788652800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "economy"."ai_credit_pack_purchase_reconciliations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "product_key" varchar(64) NOT NULL,
        "provider_transaction_id" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_credit_pack_purchase_reconciliations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_credit_pack_purchase_reconciliations_intent"
          UNIQUE ("account_id", "product_key", "provider_transaction_id"),
        CONSTRAINT "CHK_ai_credit_pack_purchase_reconciliations_product"
          CHECK ("product_key" IN ('ai_credit_pack_5', 'ai_credit_pack_20', 'ai_credit_pack_50')),
        CONSTRAINT "FK_ai_credit_pack_purchase_reconciliations_account"
          FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_ai_credit_pack_purchase_reconciliations_account"
      ON "economy"."ai_credit_pack_purchase_reconciliations" ("account_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      ALTER TABLE "support"."support_reference_records"
      DROP CONSTRAINT "CHK_support_reference_records_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "support"."support_reference_records"
      ADD CONSTRAINT "CHK_support_reference_records_type"
      CHECK ("record_type" IN (
        'ai_artwork', 'ai_credit_pack_purchase_reconciliation',
        'coin_pack_purchase_reconciliation', 'premium_purchase_reconciliation',
        'pattern_conversion', 'processing_job'
      ))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "support"."support_reference_records"
      DROP CONSTRAINT "CHK_support_reference_records_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "support"."support_reference_records"
      ADD CONSTRAINT "CHK_support_reference_records_type"
      CHECK ("record_type" IN (
        'ai_artwork', 'coin_pack_purchase_reconciliation',
        'premium_purchase_reconciliation', 'pattern_conversion', 'processing_job'
      ))
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "economy"."IDX_ai_credit_pack_purchase_reconciliations_account"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "economy"."ai_credit_pack_purchase_reconciliations"',
    );
  }
}
