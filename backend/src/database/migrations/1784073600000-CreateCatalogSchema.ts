import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCatalogSchema1784073600000 implements MigrationInterface {
  readonly name = 'CreateCatalogSchema1784073600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "catalog"');

    await queryRunner.query(`
      CREATE TABLE "catalog"."patterns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" varchar(255) NOT NULL,
        "creator_name" varchar(255) NOT NULL,
        "category_code" varchar(64) NOT NULL,
        "width" integer NOT NULL,
        "height" integer NOT NULL,
        "palette_size" integer NOT NULL,
        "artifact_object_key" varchar(512) NOT NULL,
        "artifact_checksum" char(64) NOT NULL,
        "artifact_byte_length" integer NOT NULL,
        "artifact_schema_version" integer NOT NULL,
        "preview_object_key" varchar(512) NOT NULL,
        "unlock_price_tier" varchar(16),
        "status" varchar(16) NOT NULL DEFAULT 'available',
        "published_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_patterns" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_patterns_unlock_price_tier" CHECK ("unlock_price_tier" IN ('small', 'medium', 'large') OR "unlock_price_tier" IS NULL),
        CONSTRAINT "CHK_patterns_status" CHECK ("status" IN ('available', 'withdrawn', 'removed'))
      )
    `);

    await queryRunner.query('CREATE INDEX "IDX_patterns_published_at" ON "catalog"."patterns" ("published_at" DESC)');
    await queryRunner.query('CREATE INDEX "IDX_patterns_category_code" ON "catalog"."patterns" ("category_code")');
    await queryRunner.query('CREATE INDEX "IDX_patterns_title" ON "catalog"."patterns" ("title")');
    await queryRunner.query('CREATE INDEX "IDX_patterns_creator_name" ON "catalog"."patterns" ("creator_name")');

    await queryRunner.query(`
      CREATE TABLE "catalog"."tags" (
        "code" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tags" PRIMARY KEY ("code")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "catalog"."tag_labels" (
        "tag_code" varchar(64) NOT NULL,
        "locale" varchar(8) NOT NULL,
        "label" varchar(255) NOT NULL,
        CONSTRAINT "PK_tag_labels" PRIMARY KEY ("tag_code", "locale"),
        CONSTRAINT "FK_tag_labels_tags" FOREIGN KEY ("tag_code") REFERENCES "catalog"."tags"("code") ON DELETE CASCADE
      )
    `);
    
    await queryRunner.query('CREATE INDEX "IDX_tag_labels_label" ON "catalog"."tag_labels" ("label")');

    await queryRunner.query(`
      CREATE TABLE "catalog"."pattern_tags" (
        "pattern_id" uuid NOT NULL,
        "tag_code" varchar(64) NOT NULL,
        CONSTRAINT "PK_pattern_tags" PRIMARY KEY ("pattern_id", "tag_code"),
        CONSTRAINT "FK_pattern_tags_patterns" FOREIGN KEY ("pattern_id") REFERENCES "catalog"."patterns"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pattern_tags_tags" FOREIGN KEY ("tag_code") REFERENCES "catalog"."tags"("code") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "catalog"."staff_picks" (
        "pattern_id" uuid NOT NULL,
        "position" integer NOT NULL,
        CONSTRAINT "PK_staff_picks" PRIMARY KEY ("pattern_id"),
        CONSTRAINT "UQ_staff_picks_position" UNIQUE ("position"),
        CONSTRAINT "FK_staff_picks_patterns" FOREIGN KEY ("pattern_id") REFERENCES "catalog"."patterns"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "catalog"."staff_picks"');
    await queryRunner.query('DROP TABLE IF EXISTS "catalog"."pattern_tags"');
    await queryRunner.query('DROP TABLE IF EXISTS "catalog"."tag_labels"');
    await queryRunner.query('DROP TABLE IF EXISTS "catalog"."tags"');
    await queryRunner.query('DROP TABLE IF EXISTS "catalog"."patterns"');
    await queryRunner.query('DROP SCHEMA IF EXISTS "catalog"');
  }
}
