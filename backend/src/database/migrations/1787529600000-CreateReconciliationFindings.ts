import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReconciliationFindings1787529600000
  implements MigrationInterface
{
  readonly name = 'CreateReconciliationFindings1787529600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "observability"');
    await queryRunner.query(`
      CREATE TABLE "observability"."reconciliation_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ran_at" timestamptz NOT NULL DEFAULT now(),
        "commerce_window_start" timestamptz NOT NULL,
        "commerce_delivery_without_ledger_count" integer NOT NULL,
        "commerce_ledger_without_delivery_count" integer NOT NULL,
        "storage_registry_missing_object_count" integer NOT NULL,
        "storage_orphan_object_count" integer NOT NULL,
        "ai_credit_reservation_stuck_count" integer NOT NULL,
        CONSTRAINT "PK_reconciliation_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_reconciliation_runs_ran_at" ON "observability"."reconciliation_runs" ("ran_at" DESC)',
    );
    await queryRunner.query(`
      CREATE TABLE "observability"."reconciliation_findings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "run_id" uuid NOT NULL,
        "finding_class" varchar(64) NOT NULL,
        "identifier" varchar(512) NOT NULL,
        "related_identifier" varchar(512),
        "detail" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reconciliation_findings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_reconciliation_findings_run" FOREIGN KEY ("run_id") REFERENCES "observability"."reconciliation_runs" ("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_reconciliation_findings_class" CHECK ("finding_class" IN ('commerce_delivery_without_ledger', 'commerce_ledger_without_delivery', 'storage_registry_missing_object', 'storage_orphan_object', 'ai_credit_reservation_stuck'))
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_reconciliation_findings_run_class" ON "observability"."reconciliation_findings" ("run_id", "finding_class")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "observability"."reconciliation_findings"');
    await queryRunner.query('DROP TABLE IF EXISTS "observability"."reconciliation_runs"');
  }
}
