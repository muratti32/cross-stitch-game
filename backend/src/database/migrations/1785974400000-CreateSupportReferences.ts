import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSupportReferences1785974400000 implements MigrationInterface {
  readonly name = 'CreateSupportReferences1785974400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "support"');
    await queryRunner.query(`
      CREATE TABLE "support"."support_references" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" varchar(17) NOT NULL,
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_support_references" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_support_references_code" UNIQUE ("code"),
        CONSTRAINT "CHK_support_references_principal_type"
          CHECK ("principal_type" IN ('account', 'guest'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_support_references_principal"
      ON "support"."support_references" ("principal_type", "principal_id")
    `);
    await queryRunner.query(`
      CREATE TABLE "support"."support_reference_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "support_reference_id" uuid NOT NULL,
        "record_type" varchar(64) NOT NULL,
        "record_id" uuid NOT NULL,
        CONSTRAINT "PK_support_reference_records" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_support_reference_records_reference_record"
          UNIQUE ("support_reference_id", "record_type", "record_id"),
        CONSTRAINT "CHK_support_reference_records_type"
          CHECK ("record_type" IN ('ai_artwork', 'pattern_conversion', 'processing_job')),
        CONSTRAINT "FK_support_reference_records_reference"
          FOREIGN KEY ("support_reference_id")
          REFERENCES "support"."support_references" ("id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_support_reference_records_record"
      ON "support"."support_reference_records" ("record_type", "record_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "support"."support_reference_records"');
    await queryRunner.query('DROP TABLE IF EXISTS "support"."support_references"');
    await queryRunner.query('DROP SCHEMA IF EXISTS "support"');
  }
}
