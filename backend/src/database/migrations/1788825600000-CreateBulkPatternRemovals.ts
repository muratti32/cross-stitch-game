import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBulkPatternRemovals1788825600000 implements MigrationInterface {
  readonly name = 'CreateBulkPatternRemovals1788825600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin"."bulk_pattern_removals" (
        "operator_account_id" uuid NOT NULL,
        "batch_id" uuid NOT NULL,
        "pattern_ids" jsonb NOT NULL,
        "reason" text NOT NULL,
        "removed_count" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bulk_pattern_removals" PRIMARY KEY ("operator_account_id", "batch_id"),
        CONSTRAINT "FK_bulk_pattern_removals_operator" FOREIGN KEY ("operator_account_id")
          REFERENCES "admin"."operator_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_bulk_pattern_removals_count" CHECK ("removed_count" > 0)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "admin"."bulk_pattern_removals"');
  }
}
