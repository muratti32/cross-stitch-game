import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePatternLikes1786752000000 implements MigrationInterface {
  readonly name = 'CreatePatternLikes1786752000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "social"');

    await queryRunner.query(`
      CREATE TABLE "social"."pattern_likes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "pattern_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pattern_likes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_pattern_likes_account_pattern" UNIQUE ("account_id", "pattern_id"),
        CONSTRAINT "FK_pattern_likes_account"
          FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_pattern_likes_pattern"
          FOREIGN KEY ("pattern_id") REFERENCES "catalog"."patterns" ("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_pattern_likes_account_created_at"
      ON "social"."pattern_likes" ("account_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      ALTER TABLE "catalog"."patterns"
      ADD COLUMN "like_count" integer NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "catalog"."patterns"
      DROP COLUMN IF EXISTS "like_count"
    `);

    await queryRunner.query('DROP TABLE IF EXISTS "social"."pattern_likes"');

    await queryRunner.query('DROP SCHEMA IF EXISTS "social" CASCADE');
  }
}
