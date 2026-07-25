import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOperationalAlertRuns1787616000000
  implements MigrationInterface
{
  readonly name = 'CreateOperationalAlertRuns1787616000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "observability"');
    await queryRunner.query(`
      CREATE TABLE "observability"."operational_alert_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "evaluated_at" timestamptz NOT NULL DEFAULT now(),
        "queue_depth_value" integer NOT NULL,
        "queue_depth_threshold" integer NOT NULL,
        "queue_depth_breached" boolean NOT NULL,
        "webhook_failures_value" integer NOT NULL,
        "webhook_failures_threshold" integer NOT NULL,
        "webhook_failures_breached" boolean NOT NULL,
        "stuck_jobs_value" integer NOT NULL,
        "stuck_jobs_threshold" integer NOT NULL,
        "stuck_jobs_breached" boolean NOT NULL,
        "promotion_needs_attention_value" integer NOT NULL,
        "promotion_needs_attention_threshold" integer NOT NULL,
        "promotion_needs_attention_breached" boolean NOT NULL,
        CONSTRAINT "PK_operational_alert_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_operational_alert_runs_evaluated_at" ON "observability"."operational_alert_runs" ("evaluated_at" DESC)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "observability"."operational_alert_runs"');
  }
}
