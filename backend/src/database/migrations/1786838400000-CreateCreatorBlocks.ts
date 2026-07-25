import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCreatorBlocks1786838400000 implements MigrationInterface {
  readonly name = 'CreateCreatorBlocks1786838400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "social"');

    await queryRunner.query(`
      CREATE TABLE "social"."creator_blocks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "creator_profile_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_creator_blocks" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_creator_blocks_account_creator" UNIQUE ("account_id", "creator_profile_id"),
        CONSTRAINT "FK_creator_blocks_account"
          FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_creator_blocks_creator_profile"
          FOREIGN KEY ("creator_profile_id") REFERENCES "moderation"."creator_profiles" ("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_creator_blocks_account"
      ON "social"."creator_blocks" ("account_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "social"."creator_blocks"');
  }
}
