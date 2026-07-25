import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebhookDeliveryArchives1787356800000
  implements MigrationInterface
{
  readonly name = 'CreateWebhookDeliveryArchives1787356800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "observability"');
    await queryRunner.query(`
      CREATE TABLE "observability"."webhook_delivery_archives" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "provider" varchar(16) NOT NULL,
        "provider_delivery_id" varchar(256),
        "received_at" timestamptz NOT NULL DEFAULT now(),
        "verification_result" varchar(16) NOT NULL,
        "processing_outcome" varchar(32) NOT NULL,
        "failure_reason" varchar(512),
        "payload" jsonb NOT NULL,
        "replay_count" integer NOT NULL DEFAULT 0,
        "last_replayed_at" timestamptz,
        "last_replay_outcome" varchar(32),
        "last_replay_failure_reason" varchar(512),
        "last_replayed_by_operator_id" uuid,
        CONSTRAINT "PK_webhook_delivery_archives" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_webhook_delivery_archives_provider" CHECK ("provider" IN ('revenuecat', 'admob', 'fal')),
        CONSTRAINT "CHK_webhook_delivery_archives_verification" CHECK ("verification_result" IN ('verified', 'failed')),
        CONSTRAINT "CHK_webhook_delivery_archives_outcome" CHECK ("processing_outcome" IN ('processed', 'duplicate_ignored', 'verification_failed', 'failed'))
      )
    `);
    await queryRunner.query('CREATE INDEX "IDX_webhook_delivery_archives_received_at" ON "observability"."webhook_delivery_archives" ("received_at")');
    await queryRunner.query('CREATE INDEX "IDX_webhook_delivery_archives_provider_outcome_received" ON "observability"."webhook_delivery_archives" ("provider", "processing_outcome", "received_at")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "observability"."webhook_delivery_archives"');
  }
}
