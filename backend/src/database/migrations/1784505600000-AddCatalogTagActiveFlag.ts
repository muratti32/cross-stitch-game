import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCatalogTagActiveFlag1784505600000
  implements MigrationInterface
{
  readonly name = 'AddCatalogTagActiveFlag1784505600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "catalog"."tags"
      ADD COLUMN "active" boolean NOT NULL DEFAULT true
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "catalog"."tags"
      DROP COLUMN IF EXISTS "active"
    `);
  }
}
