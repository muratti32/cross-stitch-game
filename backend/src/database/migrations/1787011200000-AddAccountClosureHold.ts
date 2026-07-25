import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountClosureHold1787011200000
  implements MigrationInterface
{
  readonly name = 'AddAccountClosureHold1787011200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "moderation"."creator_profiles"
      ADD COLUMN "closure_hold_at" timestamptz
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_creator_profiles_closure_hold_at"
      ON "moderation"."creator_profiles" ("closure_hold_at")
      WHERE "closure_hold_at" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "moderation"."IDX_creator_profiles_closure_hold_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "moderation"."creator_profiles"
      DROP COLUMN "closure_hold_at"
    `);
  }
}
