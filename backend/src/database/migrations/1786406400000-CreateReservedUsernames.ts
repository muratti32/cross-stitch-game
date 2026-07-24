import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReservedUsernames1786406400000 implements MigrationInterface {
  readonly name = 'CreateReservedUsernames1786406400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Usernames released by Moderator Username Reset. Kept forever so a
    // violating value can never be reused by any account, even after the
    // profile that held it moves on to a new one.
    await queryRunner.query(`
      CREATE TABLE "moderation"."reserved_usernames" (
        "username" varchar(30) NOT NULL,
        "profile_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reserved_usernames" PRIMARY KEY ("username"),
        CONSTRAINT "FK_reserved_usernames_profile"
          FOREIGN KEY ("profile_id") REFERENCES "moderation"."creator_profiles" ("id")
          ON DELETE RESTRICT
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "moderation"."reserved_usernames"');
  }
}
