import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePremiumPurchaseReconciliations1788480000000 implements MigrationInterface {
  readonly name = 'CreatePremiumPurchaseReconciliations1788480000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "economy"."premium_purchase_reconciliations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "operation" varchar(16) NOT NULL,
        "product_key" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_premium_purchase_reconciliations" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_premium_purchase_reconciliations_operation"
          CHECK ("operation" IN ('purchase', 'restore')),
        CONSTRAINT "CHK_premium_purchase_reconciliations_product"
          CHECK (
            ("operation" = 'restore' AND "product_key" IS NULL) OR
            ("operation" = 'purchase' AND "product_key" IN (
              'premium_weekly', 'premium_monthly', 'premium_annual'
            ))
          ),
        CONSTRAINT "FK_premium_purchase_reconciliations_account"
          FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_premium_purchase_reconciliations_account"
      ON "economy"."premium_purchase_reconciliations" ("account_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      ALTER TABLE "support"."support_reference_records"
      DROP CONSTRAINT "CHK_support_reference_records_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "support"."support_reference_records"
      ADD CONSTRAINT "CHK_support_reference_records_type"
      CHECK ("record_type" IN (
        'ai_artwork', 'premium_purchase_reconciliation', 'pattern_conversion', 'processing_job'
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
      CHECK ("record_type" IN ('ai_artwork', 'pattern_conversion', 'processing_job'))
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "economy"."IDX_premium_purchase_reconciliations_account"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."premium_purchase_reconciliations"');
  }
}
