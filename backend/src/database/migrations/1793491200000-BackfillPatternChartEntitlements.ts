import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Completed account sessions of Official Patterns finished before #287 earn the entitlement. */
export class BackfillPatternChartEntitlements1793491200000 implements MigrationInterface {
  readonly name = 'BackfillPatternChartEntitlements1793491200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "economy"."pattern_chart_entitlements" ("account_id", "pattern_id", "source")
      SELECT DISTINCT s."principal_id", s."pattern_id", 'backfill'
      FROM "sessions"."stitching_sessions" s
      INNER JOIN "catalog"."patterns" p ON p."id" = s."pattern_id"
      WHERE s."principal_type" = 'account'
        AND s."status" = 'completed'
        AND p."visibility" = 'catalog'
        AND p."creator_profile_id" IS NULL
      ON CONFLICT ON CONSTRAINT "PK_pattern_chart_entitlements" DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "economy"."pattern_chart_entitlements" WHERE "source" = 'backfill'`);
  }
}
