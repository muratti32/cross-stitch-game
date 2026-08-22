import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGuestCommercePurchaseAttempts1788998400000 implements MigrationInterface {
  readonly name = 'CreateGuestCommercePurchaseAttempts1788998400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "support"."support_reference_records" DROP CONSTRAINT "CHK_support_reference_records_type"');
    await queryRunner.query(`
      ALTER TABLE "support"."support_reference_records"
      ADD CONSTRAINT "CHK_support_reference_records_type"
      CHECK ("record_type" IN ('ai_artwork', 'ai_credit_pack_purchase_reconciliation', 'coin_pack_purchase_reconciliation', 'premium_purchase_reconciliation', 'pattern_conversion', 'processing_job', 'guest_purchase_attempt'))
    `);
    await queryRunner.query(`
      CREATE TABLE "economy"."revenuecat_subscriber_mappings" (
        "subscriber_id" varchar(255) PRIMARY KEY,
        "guest_installation_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_revenuecat_subscriber_mappings_guest"
          FOREIGN KEY ("guest_installation_id") REFERENCES "auth"."guest_installations" ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_revenuecat_subscriber_mappings_guest"
      ON "economy"."revenuecat_subscriber_mappings" ("guest_installation_id")
    `);
    await queryRunner.query(`
      CREATE TABLE "economy"."purchase_attempts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "product_id" varchar(64) NOT NULL,
        "idempotency_key" varchar(255) NOT NULL,
        "subscriber_id" varchar(255) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'created',
        "provider_transaction_id" varchar(255),
        "support_reference_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_purchase_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_purchase_attempts_idempotency" UNIQUE ("principal_type", "principal_id", "idempotency_key"),
        CONSTRAINT "CHK_purchase_attempts_principal_type" CHECK ("principal_type" IN ('guest', 'account')),
        CONSTRAINT "CHK_purchase_attempts_status" CHECK ("status" IN ('created', 'verifying', 'granted', 'failed', 'cancelled')),
        CONSTRAINT "FK_purchase_attempts_support_reference" FOREIGN KEY ("support_reference_id") REFERENCES "support"."support_references" ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_purchase_attempts_unresolved_product"
      ON "economy"."purchase_attempts" ("principal_type", "principal_id", "product_id")
      WHERE "status" IN ('created', 'verifying')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."purchase_attempts"');
    await queryRunner.query(`DELETE FROM "support"."support_reference_records" WHERE "record_type" = 'guest_purchase_attempt'`);
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."IDX_revenuecat_subscriber_mappings_guest"');
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."revenuecat_subscriber_mappings"');
    await queryRunner.query('ALTER TABLE "support"."support_reference_records" DROP CONSTRAINT "CHK_support_reference_records_type"');
    await queryRunner.query(`
      ALTER TABLE "support"."support_reference_records"
      ADD CONSTRAINT "CHK_support_reference_records_type"
      CHECK ("record_type" IN ('ai_artwork', 'ai_credit_pack_purchase_reconciliation', 'coin_pack_purchase_reconciliation', 'premium_purchase_reconciliation', 'pattern_conversion', 'processing_job'))
    `);
  }
}
