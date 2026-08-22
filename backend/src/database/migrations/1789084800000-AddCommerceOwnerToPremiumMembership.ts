import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommerceOwnerToPremiumMembership1789084800000 implements MigrationInterface {
  readonly name = 'AddCommerceOwnerToPremiumMembership1789084800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "economy"."premium_purchase_reconciliations" ALTER COLUMN "account_id" DROP NOT NULL');
    await queryRunner.query('ALTER TABLE "economy"."premium_purchase_reconciliations" ADD COLUMN "guest_installation_id" uuid NULL');
    await queryRunner.query('ALTER TABLE "economy"."premium_purchase_reconciliations" ADD CONSTRAINT "FK_premium_purchase_reconciliations_guest" FOREIGN KEY ("guest_installation_id") REFERENCES "auth"."guest_installations" ("id")');
    await queryRunner.query('ALTER TABLE "economy"."premium_purchase_reconciliations" ADD CONSTRAINT "CHK_premium_purchase_reconciliations_owner" CHECK (("account_id" IS NOT NULL AND "guest_installation_id" IS NULL) OR ("account_id" IS NULL AND "guest_installation_id" IS NOT NULL))');
    await queryRunner.query('CREATE INDEX "IDX_premium_purchase_reconciliations_guest" ON "economy"."premium_purchase_reconciliations" ("guest_installation_id", "created_at" DESC)');
    for (const table of ['membership_events', 'membership_periods']) {
      await queryRunner.query(`ALTER TABLE "economy"."${table}" ALTER COLUMN "account_id" DROP NOT NULL`);
      await queryRunner.query(`ALTER TABLE "economy"."${table}" ADD COLUMN "guest_installation_id" uuid NULL`);
      await queryRunner.query(`
        ALTER TABLE "economy"."${table}"
        ADD CONSTRAINT "FK_${table}_guest_installation"
        FOREIGN KEY ("guest_installation_id") REFERENCES "auth"."guest_installations" ("id")
      `);
      await queryRunner.query(`
        ALTER TABLE "economy"."${table}"
        ADD CONSTRAINT "CHK_${table}_owner"
        CHECK (("account_id" IS NOT NULL AND "guest_installation_id" IS NULL)
          OR ("account_id" IS NULL AND "guest_installation_id" IS NOT NULL))
      `);
    }

    await queryRunner.query('DROP INDEX "economy"."IDX_membership_events_account_history"');
    await queryRunner.query('DROP INDEX "economy"."IDX_membership_periods_account_entitlement"');
    await queryRunner.query(`CREATE INDEX "IDX_membership_events_account_history" ON "economy"."membership_events" ("account_id", "event_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_membership_events_guest_history" ON "economy"."membership_events" ("guest_installation_id", "event_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_membership_periods_account_entitlement" ON "economy"."membership_periods" ("account_id", "ends_at" DESC, "status_event_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_membership_periods_guest_entitlement" ON "economy"."membership_periods" ("guest_installation_id", "ends_at" DESC, "status_event_at" DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."IDX_premium_purchase_reconciliations_guest"');
    await queryRunner.query('ALTER TABLE "economy"."premium_purchase_reconciliations" DROP CONSTRAINT "CHK_premium_purchase_reconciliations_owner"');
    await queryRunner.query('ALTER TABLE "economy"."premium_purchase_reconciliations" DROP CONSTRAINT "FK_premium_purchase_reconciliations_guest"');
    await queryRunner.query('DELETE FROM "economy"."premium_purchase_reconciliations" WHERE "account_id" IS NULL');
    await queryRunner.query('ALTER TABLE "economy"."premium_purchase_reconciliations" DROP COLUMN "guest_installation_id"');
    await queryRunner.query('ALTER TABLE "economy"."premium_purchase_reconciliations" ALTER COLUMN "account_id" SET NOT NULL');
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."IDX_membership_periods_guest_entitlement"');
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."IDX_membership_events_guest_history"');
    for (const table of ['membership_periods', 'membership_events']) {
      await queryRunner.query(`ALTER TABLE "economy"."${table}" DROP CONSTRAINT "CHK_${table}_owner"`);
      await queryRunner.query(`ALTER TABLE "economy"."${table}" DROP CONSTRAINT "FK_${table}_guest_installation"`);
      await queryRunner.query(`DELETE FROM "economy"."${table}" WHERE "account_id" IS NULL`);
      await queryRunner.query(`ALTER TABLE "economy"."${table}" DROP COLUMN "guest_installation_id"`);
      await queryRunner.query(`ALTER TABLE "economy"."${table}" ALTER COLUMN "account_id" SET NOT NULL`);
    }
  }
}
