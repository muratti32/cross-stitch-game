import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProgressSyncSchema1784246400000 implements MigrationInterface {
  readonly name = 'CreateProgressSyncSchema1784246400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sessions"."session_sync_state" (
        "session_id" uuid NOT NULL,
        "revision" bigint NOT NULL DEFAULT 0,
        "terminal_completed_at" timestamptz,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_session_sync_state" PRIMARY KEY ("session_id"),
        CONSTRAINT "FK_session_sync_state_sessions" FOREIGN KEY ("session_id") REFERENCES "sessions"."stitching_sessions"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "sessions"."progress_operations" (
        "session_id" uuid NOT NULL,
        "op_id" uuid NOT NULL,
        "device_id" uuid NOT NULL,
        "device_seq" bigint NOT NULL,
        "cell_index" integer NOT NULL,
        "desired_state" varchar(16) NOT NULL,
        "base_revision" bigint NOT NULL,
        "server_revision" bigint NOT NULL,
        "effective" boolean NOT NULL,
        "superseded" boolean NOT NULL DEFAULT false,
        "resolved_state" varchar(16),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_progress_operations" PRIMARY KEY ("session_id", "op_id"),
        CONSTRAINT "UQ_progress_operations_device_seq" UNIQUE ("session_id", "device_id", "device_seq"),
        CONSTRAINT "CHK_progress_operations_desired_state" CHECK ("desired_state" IN ('completed', 'incomplete')),
        CONSTRAINT "CHK_progress_operations_resolved_state" CHECK ("resolved_state" IS NULL OR "resolved_state" IN ('completed', 'incomplete'))
      ) PARTITION BY HASH ("session_id")
    `);

    for (let remainder = 0; remainder < 16; remainder += 1) {
      await queryRunner.query(`
        CREATE TABLE "sessions"."progress_operations_p${remainder}"
        PARTITION OF "sessions"."progress_operations"
        FOR VALUES WITH (MODULUS 16, REMAINDER ${remainder})
      `);
    }

    await queryRunner.query(`
      CREATE INDEX "IDX_progress_operations_pull"
      ON "sessions"."progress_operations" ("session_id", "server_revision")
    `);

    await queryRunner.query(`
      CREATE TABLE "sessions"."session_cell_state" (
        "session_id" uuid NOT NULL,
        "cell_index" integer NOT NULL,
        "state" varchar(16) NOT NULL,
        "revision" bigint NOT NULL,
        CONSTRAINT "PK_session_cell_state" PRIMARY KEY ("session_id", "cell_index"),
        CONSTRAINT "FK_session_cell_state_sessions" FOREIGN KEY ("session_id") REFERENCES "sessions"."stitching_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_session_cell_state_state" CHECK ("state" IN ('completed', 'incomplete'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "sessions"."session_device_watermarks" (
        "session_id" uuid NOT NULL,
        "device_id" uuid NOT NULL,
        "applied_through_seq" bigint NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_session_device_watermarks" PRIMARY KEY ("session_id", "device_id"),
        CONSTRAINT "FK_session_device_watermarks_sessions" FOREIGN KEY ("session_id") REFERENCES "sessions"."stitching_sessions"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "sessions"."session_checkpoints" (
        "session_id" uuid NOT NULL,
        "revision" bigint NOT NULL,
        "packed_bitmap" bytea NOT NULL,
        "checksum" char(64) NOT NULL,
        "format_version" integer NOT NULL DEFAULT 1,
        "device_watermarks" jsonb NOT NULL DEFAULT '{}',
        "terminal_completed" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_session_checkpoints" PRIMARY KEY ("session_id", "revision"),
        CONSTRAINT "FK_session_checkpoints_sessions" FOREIGN KEY ("session_id") REFERENCES "sessions"."stitching_sessions"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "sessions"."session_checkpoints"');
    await queryRunner.query('DROP TABLE IF EXISTS "sessions"."session_device_watermarks"');
    await queryRunner.query('DROP TABLE IF EXISTS "sessions"."session_cell_state"');
    await queryRunner.query('DROP TABLE IF EXISTS "sessions"."progress_operations"');
    await queryRunner.query('DROP TABLE IF EXISTS "sessions"."session_sync_state"');
  }
}
