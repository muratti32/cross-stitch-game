import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePatternConversionSchema1784332800000
  implements MigrationInterface
{
  readonly name = 'CreatePatternConversionSchema1784332800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "conversion"');

    await queryRunner.query(`
      ALTER TABLE "catalog"."patterns"
      ADD COLUMN "visibility" varchar(16) NOT NULL DEFAULT 'catalog',
      ADD COLUMN "owner_account_id" uuid,
      ADD CONSTRAINT "CHK_patterns_visibility_owner"
        CHECK (("visibility" = 'catalog' AND "owner_account_id" IS NULL) OR
               ("visibility" = 'personal' AND "owner_account_id" IS NOT NULL)),
      ADD CONSTRAINT "FK_patterns_owner_account"
        FOREIGN KEY ("owner_account_id") REFERENCES "auth"."registered_accounts"("id")
        ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_patterns_owner_account"
      ON "catalog"."patterns" ("owner_account_id", "created_at" DESC)
      WHERE "visibility" = 'personal'
    `);

    await queryRunner.query(`
      CREATE TABLE "conversion"."pattern_conversions" (
        "processing_job_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "target_pattern_id" uuid NOT NULL,
        "upload_object_key" varchar(512) NOT NULL,
        "upload_checksum" char(64) NOT NULL,
        "upload_byte_length" integer NOT NULL,
        "upload_content_type" varchar(64) NOT NULL,
        "profile" varchar(16) NOT NULL,
        "short_edge_cells" integer NOT NULL,
        "max_colors" integer NOT NULL,
        "framed_width" integer NOT NULL,
        "framed_height" integer NOT NULL,
        "title" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pattern_conversions" PRIMARY KEY ("processing_job_id"),
        CONSTRAINT "UQ_pattern_conversions_target_pattern_id" UNIQUE ("target_pattern_id"),
        CONSTRAINT "CHK_pattern_conversions_profile" CHECK ("profile" IN ('easy', 'standard', 'detailed', 'custom')),
        CONSTRAINT "FK_pattern_conversions_job" FOREIGN KEY ("processing_job_id") REFERENCES "jobs"."processing_jobs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pattern_conversions_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "conversion"."personal_patterns" (
        "pattern_id" uuid NOT NULL,
        "owner_account_id" uuid NOT NULL,
        "processing_job_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_personal_patterns" PRIMARY KEY ("pattern_id"),
        CONSTRAINT "UQ_personal_patterns_processing_job_id" UNIQUE ("processing_job_id"),
        CONSTRAINT "FK_personal_patterns_pattern" FOREIGN KEY ("pattern_id") REFERENCES "catalog"."patterns"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_personal_patterns_owner" FOREIGN KEY ("owner_account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_personal_patterns_job" FOREIGN KEY ("processing_job_id") REFERENCES "jobs"."processing_jobs"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "conversion"."conversion_recipes" (
        "pattern_id" uuid NOT NULL,
        "engine_version" varchar(64) NOT NULL,
        "dmc_palette_version" varchar(64) NOT NULL,
        "recipe_version" varchar(64) NOT NULL,
        "profile" varchar(16) NOT NULL,
        "short_edge_cells" integer NOT NULL,
        "max_colors" integer NOT NULL,
        "width" integer NOT NULL,
        "height" integer NOT NULL,
        CONSTRAINT "PK_conversion_recipes" PRIMARY KEY ("pattern_id"),
        CONSTRAINT "FK_conversion_recipes_personal_pattern" FOREIGN KEY ("pattern_id") REFERENCES "conversion"."personal_patterns"("pattern_id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "conversion"."conversion_recipes"');
    await queryRunner.query('DROP TABLE IF EXISTS "conversion"."personal_patterns"');
    await queryRunner.query('DROP TABLE IF EXISTS "conversion"."pattern_conversions"');
    await queryRunner.query('DROP SCHEMA IF EXISTS "conversion"');
    await queryRunner.query('DROP INDEX IF EXISTS "catalog"."IDX_patterns_owner_account"');
    await queryRunner.query(`
      ALTER TABLE "catalog"."patterns"
      DROP CONSTRAINT IF EXISTS "FK_patterns_owner_account",
      DROP CONSTRAINT IF EXISTS "CHK_patterns_visibility_owner",
      DROP COLUMN IF EXISTS "owner_account_id",
      DROP COLUMN IF EXISTS "visibility"
    `);
  }
}
