import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStitchableCellCountToPatterns1793232000000 implements MigrationInterface {
  readonly name = 'AddStitchableCellCountToPatterns1793232000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "catalog"."patterns"
      ADD COLUMN "stitchable_cell_count" integer NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "catalog"."patterns"
      DROP COLUMN "stitchable_cell_count"
    `);
  }
}
