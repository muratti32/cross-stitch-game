import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddObjectRegistryLastVerifiedAt1792540800000 implements MigrationInterface {
  readonly name = 'AddObjectRegistryLastVerifiedAt1792540800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "storage"."object_registry"
      ADD COLUMN IF NOT EXISTS "last_verified_at" timestamptz NULL
    `);

    // Supports the bounded reconciler sweep: oldest-verified-first over active rows.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_object_registry_active_last_verified_at"
      ON "storage"."object_registry" ("last_verified_at" ASC NULLS FIRST)
      WHERE "state" IN ('committed', 'available')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "storage"."IDX_object_registry_active_last_verified_at"',
    );
    await queryRunner.query(
      'ALTER TABLE "storage"."object_registry" DROP COLUMN IF EXISTS "last_verified_at"',
    );
  }
}
