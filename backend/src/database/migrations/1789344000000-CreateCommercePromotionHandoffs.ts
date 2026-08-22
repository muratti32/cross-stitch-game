import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCommercePromotionHandoffs1789344000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
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
        CONSTRAINT "FK_commerce_promotion_handoffs_guest" FOREIGN KEY ("guest_id") REFERENCES "auth"."guest_installations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_commerce_promotion_handoffs_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query('CREATE INDEX "IDX_commerce_promotion_handoffs_account" ON "promotion"."commerce_promotion_handoffs" ("account_id", "updated_at" DESC)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "promotion"."commerce_promotion_handoffs"');
  }
}
