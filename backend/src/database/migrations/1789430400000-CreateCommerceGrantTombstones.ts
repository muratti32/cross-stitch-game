import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCommerceGrantTombstones1789430400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "economy"."commerce_grant_tombstones" (
        "source_key" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_commerce_grant_tombstones" PRIMARY KEY ("source_key")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "economy"."commerce_grant_tombstones"');
  }
}
