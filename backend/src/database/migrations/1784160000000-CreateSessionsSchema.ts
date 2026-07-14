import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSessionsSchema1784160000000 implements MigrationInterface {
  readonly name = 'CreateSessionsSchema1784160000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "sessions"');
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "storage"');

    await queryRunner.query(`
      CREATE TABLE "sessions"."stitching_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "principal_type" varchar(64) NOT NULL,
        "principal_id" uuid NOT NULL,
        "pattern_id" uuid NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'active',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "completed_at" timestamptz,
        CONSTRAINT "PK_stitching_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_stitching_sessions_patterns" FOREIGN KEY ("pattern_id") REFERENCES "catalog"."patterns"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_stitching_sessions_status" CHECK ("status" IN ('active', 'completed'))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_stitching_sessions_active" 
      ON "sessions"."stitching_sessions" ("principal_type", "principal_id", "pattern_id") 
      WHERE "status" = 'active'
    `);

    await queryRunner.query(`
      CREATE TABLE "sessions"."session_progress_flags" (
        "session_id" uuid NOT NULL,
        "has_any_progress" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_session_progress_flags" PRIMARY KEY ("session_id"),
        CONSTRAINT "FK_session_progress_flags_sessions" FOREIGN KEY ("session_id") REFERENCES "sessions"."stitching_sessions"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "storage"."object_registry" (
        "object_key" varchar(512) NOT NULL,
        "checksum" char(64) NOT NULL,
        "byte_length" integer NOT NULL,
        "state" varchar(32) NOT NULL,
        "missing" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_object_registry" PRIMARY KEY ("object_key"),
        CONSTRAINT "CHK_object_registry_state" CHECK ("state" IN ('uploading', 'verified', 'committed', 'available'))
      )
    `);

    // Backfill already seeded pattern artifacts as 'available'
    await queryRunner.query(`
      INSERT INTO "storage"."object_registry" ("object_key", "checksum", "byte_length", "state", "missing")
      SELECT "artifact_object_key", "artifact_checksum", "artifact_byte_length", 'available', false
      FROM "catalog"."patterns"
      ON CONFLICT DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "storage"."object_registry"');
    await queryRunner.query('DROP TABLE IF EXISTS "sessions"."session_progress_flags"');
    await queryRunner.query('DROP INDEX IF EXISTS "sessions"."UQ_stitching_sessions_active"');
    await queryRunner.query('DROP TABLE IF EXISTS "sessions"."stitching_sessions"');
    await queryRunner.query('DROP SCHEMA IF EXISTS "storage"');
    await queryRunner.query('DROP SCHEMA IF EXISTS "sessions"');
  }
}
