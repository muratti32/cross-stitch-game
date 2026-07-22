import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePromotionSchema1785369600000 implements MigrationInterface {
  readonly name = 'CreatePromotionSchema1785369600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "promotion"');

    // Promotion locks to prevent concurrent mutations on guest ledger
    await queryRunner.query(`
      CREATE TABLE "promotion"."locks" (
        "guest_id" uuid NOT NULL,
        "token" uuid NOT NULL DEFAULT gen_random_uuid(),
        "expiry" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promotion_locks" PRIMARY KEY ("guest_id")
      )
    `);

    // Staging packages containing guest data (likes, progress, completions)
    await queryRunner.query(`
      CREATE TABLE "promotion"."transfer_packages" (
        "guest_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "manifest_checksum" varchar(64) NOT NULL,
        "package_data" jsonb NOT NULL,
        "checksum" varchar(64) NOT NULL,
        "expiry" timestamptz NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'staged',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_promotion_transfer_packages" PRIMARY KEY ("guest_id"),
        CONSTRAINT "CHK_promotion_transfer_packages_status" CHECK ("status" IN ('staged', 'committed', 'cancelled'))
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "promotion"."transfer_packages"');
    await queryRunner.query('DROP TABLE IF EXISTS "promotion"."locks"');
    await queryRunner.query('DROP SCHEMA IF EXISTS "promotion"');
  }
}
