import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOperatorManagedLocatorPrice1792800000000 implements MigrationInterface {
  readonly name = 'AddOperatorManagedLocatorPrice1792800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "economy"."locator_price_setting" (
        "id" smallint NOT NULL,
        "price_coin" integer NOT NULL,
        "updated_by_operator_id" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_locator_price_setting" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_locator_price_setting_singleton" CHECK ("id" = 1),
        CONSTRAINT "CHK_locator_price_setting_price" CHECK ("price_coin" BETWEEN 1 AND 10)
      )
    `);
    // Seeds today's fixed price so the deploy does not change player-facing cost.
    await queryRunner.query(`INSERT INTO "economy"."locator_price_setting" ("id", "price_coin") VALUES (1, 1)`);
    // Existing attempts were all reserved at the former fixed 1-Coin price. The
    // default stays so API instances still on the fixed-price code keep inserting
    // valid attempts during a rolling deploy.
    await queryRunner.query(`
      ALTER TABLE "economy"."locator_attempts"
      ADD COLUMN "reserved_price" integer NOT NULL DEFAULT 1,
      ADD CONSTRAINT "CHK_locator_attempts_reserved_price" CHECK ("reserved_price" BETWEEN 1 AND 10)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Fixed-price code would refund or cancel these at 1 Coin, losing the rest.
    const locked = await queryRunner.query(
      `SELECT count(*)::int AS count FROM "economy"."locator_attempts"
       WHERE "status" IN ('prepared', 'committed') AND "reserved_price" <> 1`,
    ) as readonly { count: number }[];
    if ((locked[0]?.count ?? 0) > 0) {
      throw new Error('Cannot revert Locator Price: open locator attempts are locked at a price other than 1 Coin');
    }
    await queryRunner.query('ALTER TABLE "economy"."locator_attempts" DROP CONSTRAINT IF EXISTS "CHK_locator_attempts_reserved_price"');
    await queryRunner.query('ALTER TABLE "economy"."locator_attempts" DROP COLUMN IF EXISTS "reserved_price"');
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."locator_price_setting"');
  }
}
