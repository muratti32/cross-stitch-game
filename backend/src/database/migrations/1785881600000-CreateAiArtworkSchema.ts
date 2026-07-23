import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiArtworkSchema1785881600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "ai"');
    await queryRunner.query(`CREATE TABLE "ai"."ai_artworks" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "account_id" uuid NOT NULL,
      "processing_job_id" uuid NOT NULL, "prompt" text NOT NULL, "aspect" varchar(20) NOT NULL,
      "status" varchar(24) NOT NULL, "provider_request_key" uuid NOT NULL,
      "provider_request_id" varchar(255), "image_object_key" varchar(512),
      "image_content_type" varchar(128), "image_checksum" varchar(64), "image_byte_length" bigint,
      "failure_reason" text, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CHK_ai_artworks_aspect" CHECK ("aspect" IN ('square','portrait_4_3','landscape_4_3')),
      CONSTRAINT "CHK_ai_artworks_status" CHECK ("status" IN ('pending','submitting','submitted','delivered','safety_rejected','failed','deleted')),
      CONSTRAINT "FK_ai_artworks_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_ai_artworks_job" FOREIGN KEY ("processing_job_id") REFERENCES "jobs"."processing_jobs"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_ai_artworks_processing_job" ON "ai"."ai_artworks" ("processing_job_id")');
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_ai_artworks_provider_request" ON "ai"."ai_artworks" ("provider_request_id") WHERE "provider_request_id" IS NOT NULL');
    await queryRunner.query('CREATE INDEX "IDX_ai_artworks_owner" ON "ai"."ai_artworks" ("account_id", "created_at" DESC)');
    await queryRunner.query(`CREATE TABLE "ai"."ai_credit_reservations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "account_id" uuid NOT NULL,
      "processing_job_id" uuid NOT NULL, "status" varchar(12) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_ai_credit_reservations_processing_job" UNIQUE ("processing_job_id"),
      CONSTRAINT "CHK_ai_credit_reservation_status" CHECK ("status" IN ('reserved','captured','released')),
      CONSTRAINT "FK_ai_credit_reservation_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_ai_credit_reservation_job" FOREIGN KEY ("processing_job_id") REFERENCES "jobs"."processing_jobs"("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(`CREATE TABLE "ai"."prompt_safety_attempts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "account_id" uuid NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_prompt_safety_attempt_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query('CREATE INDEX "IDX_prompt_safety_attempts_account_time" ON "ai"."prompt_safety_attempts" ("account_id", "created_at" DESC)');
    await queryRunner.query('ALTER TABLE "economy"."ai_credit_ledger_entries" DROP CONSTRAINT "CHK_ai_credit_ledger_entries_reason"');
    await queryRunner.query(`ALTER TABLE "economy"."ai_credit_ledger_entries" ADD CONSTRAINT "CHK_ai_credit_ledger_entries_reason" CHECK ("reason" IN ('pack_purchase','commerce_reversal','membership_credit_grant','membership_reversal','ai_artwork_delivery'))`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "ai"."prompt_safety_attempts"');
    await queryRunner.query('DROP TABLE IF EXISTS "ai"."ai_credit_reservations"');
    await queryRunner.query('DROP TABLE IF EXISTS "ai"."ai_artworks"');
    await queryRunner.query('ALTER TABLE "economy"."ai_credit_ledger_entries" DROP CONSTRAINT "CHK_ai_credit_ledger_entries_reason"');
    await queryRunner.query(`ALTER TABLE "economy"."ai_credit_ledger_entries" ADD CONSTRAINT "CHK_ai_credit_ledger_entries_reason" CHECK ("reason" IN ('pack_purchase','commerce_reversal','membership_credit_grant','membership_reversal'))`);
  }
}
