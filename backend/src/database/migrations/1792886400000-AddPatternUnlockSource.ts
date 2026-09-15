import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPatternUnlockSource1792886400000
  implements MigrationInterface
{
  readonly name = 'AddPatternUnlockSource1792886400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "economy"."pattern_unlocks"
       ADD COLUMN "source" varchar(32) NOT NULL DEFAULT 'coin_spend'`,
    );
    await queryRunner.query(
      `ALTER TABLE "economy"."pattern_unlocks"
       ADD CONSTRAINT "CHK_pattern_unlocks_source"
       CHECK ("source" IN ('coin_spend', 'grandfathered'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "economy"."pattern_unlocks"
       DROP CONSTRAINT "CHK_pattern_unlocks_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "economy"."pattern_unlocks"
       DROP COLUMN "source"`,
    );
  }
}
