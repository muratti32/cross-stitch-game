import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowModeratorUsernameReset1786492800000
  implements MigrationInterface
{
  readonly name = 'AllowModeratorUsernameReset1786492800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Moderator Username Reset is the sole exceptional path allowed to
    // change an otherwise-permanent username. It opts in per-transaction via
    // a local session setting; every other write path is still rejected.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "moderation"."reject_creator_profile_username_change"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."username" IS DISTINCT FROM OLD."username"
           AND current_setting('app.moderator_username_reset', true) IS DISTINCT FROM 'on' THEN
          RAISE EXCEPTION 'Creator Profile username is immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "moderation"."reject_creator_profile_username_change"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."username" IS DISTINCT FROM OLD."username" THEN
          RAISE EXCEPTION 'Creator Profile username is immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
  }
}
