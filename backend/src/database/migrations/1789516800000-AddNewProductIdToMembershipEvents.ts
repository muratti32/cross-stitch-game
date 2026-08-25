import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNewProductIdToMembershipEvents1789516800000 implements MigrationInterface {
  readonly name = 'AddNewProductIdToMembershipEvents1789516800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "economy"."membership_events" ADD COLUMN "new_product_id" varchar(255) NULL',
    );
    // Serves the scheduled-downgrade lookup: the latest PRODUCT_CHANGE per
    // owner that still names a target product (issue #124).
    await queryRunner.query(`
      CREATE INDEX "IDX_membership_events_product_change_account"
      ON "economy"."membership_events" ("account_id", "event_at" DESC)
      WHERE "event_type" = 'PRODUCT_CHANGE' AND "new_product_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_membership_events_product_change_guest"
      ON "economy"."membership_events" ("guest_installation_id", "event_at" DESC)
      WHERE "event_type" = 'PRODUCT_CHANGE' AND "new_product_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."IDX_membership_events_product_change_guest"');
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."IDX_membership_events_product_change_account"');
    await queryRunner.query('ALTER TABLE "economy"."membership_events" DROP COLUMN "new_product_id"');
  }
}
