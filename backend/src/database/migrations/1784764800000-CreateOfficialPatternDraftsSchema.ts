import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOfficialPatternDraftsSchema1784764800000
  implements MigrationInterface
{
  readonly name = 'CreateOfficialPatternDraftsSchema1784764800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin"."official_pattern_drafts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_by_operator_id" uuid NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "source_object_key" varchar(512) NOT NULL,
        "source_checksum" char(64) NOT NULL,
        "source_byte_length" integer NOT NULL,
        "source_content_type" varchar(64) NOT NULL,
        "source_width" integer NOT NULL,
        "source_height" integer NOT NULL,
        "short_edge_cells" integer NOT NULL,
        "max_colors" integer NOT NULL,
        "processing_job_id" uuid,
        "artifact_object_key" varchar(512),
        "artifact_checksum" char(64),
        "artifact_byte_length" integer,
        "artifact_schema_version" integer,
        "preview_object_key" varchar(512),
        "width" integer,
        "height" integer,
        "palette_size" integer,
        "stitchable_cell_count" integer,
        "failure_reason" text,
        "published_pattern_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_official_pattern_drafts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_official_pattern_drafts_processing_job_id" UNIQUE ("processing_job_id"),
        CONSTRAINT "UQ_official_pattern_drafts_published_pattern_id" UNIQUE ("published_pattern_id"),
        CONSTRAINT "CHK_official_pattern_drafts_status" CHECK (
          "status" IN ('pending', 'processing', 'ready', 'failed', 'published', 'discarded')
        ),
        CONSTRAINT "CHK_official_pattern_drafts_short_edge_cells" CHECK (
          "short_edge_cells" >= 20 AND "short_edge_cells" <= 300
        ),
        CONSTRAINT "CHK_official_pattern_drafts_max_colors" CHECK (
          "max_colors" >= 5 AND "max_colors" <= 60
        ),
        CONSTRAINT "FK_official_pattern_drafts_operator"
          FOREIGN KEY ("created_by_operator_id")
          REFERENCES "admin"."operator_accounts" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_official_pattern_drafts_job"
          FOREIGN KEY ("processing_job_id")
          REFERENCES "jobs"."processing_jobs" ("id")
          ON DELETE SET NULL,
        CONSTRAINT "FK_official_pattern_drafts_pattern"
          FOREIGN KEY ("published_pattern_id")
          REFERENCES "catalog"."patterns" ("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_official_pattern_drafts_status_created"
      ON "admin"."official_pattern_drafts" ("status", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_official_pattern_drafts_operator"
      ON "admin"."official_pattern_drafts" ("created_by_operator_id", "created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "admin"."official_pattern_drafts"');
  }
}
