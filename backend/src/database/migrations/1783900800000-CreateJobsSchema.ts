import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJobsSchema1783900800000 implements MigrationInterface {
  readonly name = 'CreateJobsSchema1783900800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "jobs"');

    await queryRunner.query(`
      CREATE TABLE "jobs"."processing_jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "type" varchar(64) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'pending',
        "payload" jsonb NOT NULL,
        "result" jsonb,
        "error_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_processing_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_processing_jobs_status"
          CHECK ("status" IN ('pending', 'dispatched', 'running', 'completed', 'failed'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_processing_jobs_status"
      ON "jobs"."processing_jobs" ("status")
    `);

    await queryRunner.query(`
      CREATE TABLE "jobs"."job_outbox" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "processing_job_id" uuid NOT NULL,
        "queue_name" varchar(128) NOT NULL,
        "event_name" varchar(128) NOT NULL,
        "payload" jsonb NOT NULL,
        "dispatched_at" timestamptz,
        "last_reconciled_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_job_outbox" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_job_outbox_processing_job_id" UNIQUE ("processing_job_id"),
        CONSTRAINT "FK_job_outbox_processing_job"
          FOREIGN KEY ("processing_job_id")
          REFERENCES "jobs"."processing_jobs" ("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_job_outbox_undispatched"
      ON "jobs"."job_outbox" ("created_at", "id")
      WHERE "dispatched_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_job_outbox_reconciliation"
      ON "jobs"."job_outbox" ("last_reconciled_at", "created_at", "id")
      WHERE "dispatched_at" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "jobs"."job_outbox"');
    await queryRunner.query('DROP TABLE IF EXISTS "jobs"."processing_jobs"');
    await queryRunner.query('DROP SCHEMA IF EXISTS "jobs"');
  }
}
