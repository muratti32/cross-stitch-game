import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCommercePromotionHandoffs1789344000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "economy"."coin_ledger_entries" DROP CONSTRAINT "CHK_coin_ledger_entries_reason", ADD CONSTRAINT "CHK_coin_ledger_entries_reason" CHECK ("reason" IN ('ad_reward','first_completion','unlock_spend','daily_task','guest_promotion','coin_pack_purchase','commerce_reversal','premium_daily_claim','commerce_transfer'))`);
    await queryRunner.query(`ALTER TABLE "economy"."ai_credit_ledger_entries" DROP CONSTRAINT "CHK_ai_credit_ledger_entries_reason", ADD CONSTRAINT "CHK_ai_credit_ledger_entries_reason" CHECK ("reason" IN ('pack_purchase','commerce_reversal','membership_credit_grant','membership_reversal','ai_artwork_delivery','commerce_transfer'))`);
    await queryRunner.query(`
      CREATE TABLE "promotion"."commerce_promotion_handoffs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "guest_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "state" varchar(20) NOT NULL DEFAULT 'pending',
        "attempt_count" integer NOT NULL DEFAULT 0,
        "last_failure_reason" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_commerce_promotion_handoffs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_commerce_promotion_handoffs_guest_account" UNIQUE ("guest_id", "account_id"),
        CONSTRAINT "CHK_commerce_promotion_handoffs_state" CHECK ("state" IN ('pending','processing','acknowledged','failed')),
        CONSTRAINT "FK_commerce_promotion_handoffs_guest" FOREIGN KEY ("guest_id") REFERENCES "auth"."guest_installations"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_commerce_promotion_handoffs_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query('CREATE INDEX "IDX_commerce_promotion_handoffs_account" ON "promotion"."commerce_promotion_handoffs" ("account_id", "updated_at" DESC)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "promotion"."commerce_promotion_handoffs"');
    await queryRunner.query(`ALTER TABLE "economy"."coin_ledger_entries" DROP CONSTRAINT "CHK_coin_ledger_entries_reason", ADD CONSTRAINT "CHK_coin_ledger_entries_reason" CHECK ("reason" IN ('ad_reward','first_completion','unlock_spend','daily_task','guest_promotion','coin_pack_purchase','commerce_reversal','premium_daily_claim'))`);
    await queryRunner.query(`ALTER TABLE "economy"."ai_credit_ledger_entries" DROP CONSTRAINT "CHK_ai_credit_ledger_entries_reason", ADD CONSTRAINT "CHK_ai_credit_ledger_entries_reason" CHECK ("reason" IN ('pack_purchase','commerce_reversal','membership_credit_grant','membership_reversal','ai_artwork_delivery'))`);
  }
}
