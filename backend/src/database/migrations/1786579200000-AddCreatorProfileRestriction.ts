import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCreatorProfileRestriction1786579200000
  implements MigrationInterface
{
  readonly name = 'AddCreatorProfileRestriction1786579200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Non-destructive: the stored username/display name/avatar are kept as
    // they were so a future appeal (a later ticket) can restore them. Public
    // presentation is masked at the read path while this is set.
    await queryRunner.query(`
      ALTER TABLE "moderation"."creator_profiles"
      ADD COLUMN "restricted_at" timestamptz
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "moderation"."creator_profiles"
      DROP COLUMN "restricted_at"
    `);
  }
}
