import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Account sync never set has_any_progress (#292); sessions with synced cells must not look empty to cancelSession. */
export class BackfillSessionProgressFlags1793318400000 implements MigrationInterface {
  readonly name = 'BackfillSessionProgressFlags1793318400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "sessions"."session_progress_flags" ("session_id", "has_any_progress")
      SELECT DISTINCT "session_id", true FROM "sessions"."session_cell_state"
      ON CONFLICT ("session_id") DO UPDATE SET "has_any_progress" = true
    `);
  }

  async down(): Promise<void> {
    // Data backfill: the previous flag values are not recoverable.
  }
}
