import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Issue #110: widen AI Artwork and Personal Pattern ownership to Guest Installation Identity. */
export class AddGuestAiArtworkAndPatternOwnership1789171200000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ai"."ai_artworks"
        ADD COLUMN "guest_installation_id" uuid NULL,
        ALTER COLUMN "account_id" DROP NOT NULL,
        DROP CONSTRAINT "FK_ai_artworks_account",
        ADD CONSTRAINT "FK_ai_artworks_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "FK_ai_artworks_guest" FOREIGN KEY ("guest_installation_id") REFERENCES "auth"."guest_installations"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "CHK_ai_artworks_owner" CHECK (("account_id" IS NOT NULL) <> ("guest_installation_id" IS NOT NULL))
    `);
    await queryRunner.query(`CREATE INDEX "IDX_ai_artworks_guest_owner" ON "ai"."ai_artworks" ("guest_installation_id", "created_at" DESC)`);

    await queryRunner.query(`
      ALTER TABLE "ai"."ai_credit_reservations"
        ADD COLUMN "guest_installation_id" uuid NULL,
        ALTER COLUMN "account_id" DROP NOT NULL,
        DROP CONSTRAINT "FK_ai_credit_reservation_account",
        ADD CONSTRAINT "FK_ai_credit_reservation_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "FK_ai_credit_reservation_guest" FOREIGN KEY ("guest_installation_id") REFERENCES "auth"."guest_installations"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "CHK_ai_credit_reservations_owner" CHECK (("account_id" IS NOT NULL) <> ("guest_installation_id" IS NOT NULL))
    `);
    await queryRunner.query(`CREATE INDEX "IDX_ai_credit_reservations_guest_owner" ON "ai"."ai_credit_reservations" ("guest_installation_id", "created_at" DESC)`);

    await queryRunner.query(`
      ALTER TABLE "ai"."prompt_safety_attempts"
        ADD COLUMN "guest_installation_id" uuid NULL,
        ALTER COLUMN "account_id" DROP NOT NULL,
        DROP CONSTRAINT "FK_prompt_safety_attempt_account",
        ADD CONSTRAINT "FK_prompt_safety_attempt_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "FK_prompt_safety_attempt_guest" FOREIGN KEY ("guest_installation_id") REFERENCES "auth"."guest_installations"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "CHK_prompt_safety_attempts_owner" CHECK (("account_id" IS NOT NULL) <> ("guest_installation_id" IS NOT NULL))
    `);
    await queryRunner.query(`CREATE INDEX "IDX_prompt_safety_attempts_guest_time" ON "ai"."prompt_safety_attempts" ("guest_installation_id", "created_at" DESC)`);

    await queryRunner.query(`
      ALTER TABLE "catalog"."patterns"
        ADD COLUMN "guest_installation_id" uuid NULL,
        DROP CONSTRAINT "CHK_patterns_visibility_owner",
        DROP CONSTRAINT "FK_patterns_owner_account",
        ADD CONSTRAINT "CHK_patterns_visibility_owner" CHECK (("visibility" = 'catalog' AND "owner_account_id" IS NULL AND "guest_installation_id" IS NULL) OR ("visibility" = 'personal' AND (("owner_account_id" IS NOT NULL) <> ("guest_installation_id" IS NOT NULL)))),
        ADD CONSTRAINT "FK_patterns_owner_account" FOREIGN KEY ("owner_account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "FK_patterns_owner_guest" FOREIGN KEY ("guest_installation_id") REFERENCES "auth"."guest_installations"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`CREATE INDEX "IDX_patterns_owner_guest" ON "catalog"."patterns" ("guest_installation_id", "created_at" DESC) WHERE "visibility" = 'personal'`);

    await queryRunner.query(`
      ALTER TABLE "conversion"."pattern_conversions"
        ADD COLUMN "guest_installation_id" uuid NULL,
        ALTER COLUMN "account_id" DROP NOT NULL,
        DROP CONSTRAINT "FK_pattern_conversions_account",
        ADD CONSTRAINT "FK_pattern_conversions_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "FK_pattern_conversions_guest" FOREIGN KEY ("guest_installation_id") REFERENCES "auth"."guest_installations"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "CHK_pattern_conversions_owner" CHECK (("account_id" IS NOT NULL) <> ("guest_installation_id" IS NOT NULL))
    `);
    await queryRunner.query(`CREATE INDEX "IDX_pattern_conversions_guest_owner" ON "conversion"."pattern_conversions" ("guest_installation_id", "created_at" DESC)`);

    await queryRunner.query(`
      ALTER TABLE "conversion"."personal_patterns"
        ADD COLUMN "guest_installation_id" uuid NULL,
        ALTER COLUMN "owner_account_id" DROP NOT NULL,
        DROP CONSTRAINT "FK_personal_patterns_owner",
        ADD CONSTRAINT "FK_personal_patterns_owner" FOREIGN KEY ("owner_account_id") REFERENCES "auth"."registered_accounts"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "FK_personal_patterns_guest" FOREIGN KEY ("guest_installation_id") REFERENCES "auth"."guest_installations"("id") ON DELETE CASCADE,
        ADD CONSTRAINT "CHK_personal_patterns_owner" CHECK (("owner_account_id" IS NOT NULL) <> ("guest_installation_id" IS NOT NULL))
    `);
    await queryRunner.query(`CREATE INDEX "IDX_personal_patterns_guest_owner" ON "conversion"."personal_patterns" ("guest_installation_id", "created_at" DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "conversion"."personal_patterns" WHERE "guest_installation_id" IS NOT NULL`);
    await queryRunner.query(`DELETE FROM "conversion"."pattern_conversions" WHERE "guest_installation_id" IS NOT NULL`);
    await queryRunner.query(`DELETE FROM "catalog"."patterns" WHERE "guest_installation_id" IS NOT NULL`);
    await queryRunner.query(`DELETE FROM "ai"."ai_credit_reservations" WHERE "guest_installation_id" IS NOT NULL`);
    await queryRunner.query(`DELETE FROM "ai"."ai_artworks" WHERE "guest_installation_id" IS NOT NULL`);
    await queryRunner.query(`DELETE FROM "ai"."prompt_safety_attempts" WHERE "guest_installation_id" IS NOT NULL`);

    await queryRunner.query(`DROP INDEX IF EXISTS "ai"."IDX_ai_artworks_guest_owner"`);
    await queryRunner.query(`ALTER TABLE "ai"."ai_artworks" DROP CONSTRAINT "CHK_ai_artworks_owner", DROP CONSTRAINT "FK_ai_artworks_guest", DROP COLUMN "guest_installation_id", ALTER COLUMN "account_id" SET NOT NULL`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ai"."IDX_ai_credit_reservations_guest_owner"`);
    await queryRunner.query(`ALTER TABLE "ai"."ai_credit_reservations" DROP CONSTRAINT "CHK_ai_credit_reservations_owner", DROP CONSTRAINT "FK_ai_credit_reservation_guest", DROP COLUMN "guest_installation_id", ALTER COLUMN "account_id" SET NOT NULL`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ai"."IDX_prompt_safety_attempts_guest_time"`);
    await queryRunner.query(`ALTER TABLE "ai"."prompt_safety_attempts" DROP CONSTRAINT "CHK_prompt_safety_attempts_owner", DROP CONSTRAINT "FK_prompt_safety_attempt_guest", DROP COLUMN "guest_installation_id", ALTER COLUMN "account_id" SET NOT NULL`);
    await queryRunner.query(`DROP INDEX IF EXISTS "catalog"."IDX_patterns_owner_guest"`);
    await queryRunner.query(`ALTER TABLE "catalog"."patterns" DROP CONSTRAINT "CHK_patterns_visibility_owner", DROP CONSTRAINT "FK_patterns_owner_guest", DROP COLUMN "guest_installation_id", ADD CONSTRAINT "CHK_patterns_visibility_owner" CHECK (("visibility" = 'catalog' AND "owner_account_id" IS NULL) OR ("visibility" = 'personal' AND "owner_account_id" IS NOT NULL))`);
    await queryRunner.query(`DROP INDEX IF EXISTS "conversion"."IDX_pattern_conversions_guest_owner"`);
    await queryRunner.query(`ALTER TABLE "conversion"."pattern_conversions" DROP CONSTRAINT "CHK_pattern_conversions_owner", DROP CONSTRAINT "FK_pattern_conversions_guest", DROP COLUMN "guest_installation_id", ALTER COLUMN "account_id" SET NOT NULL`);
    await queryRunner.query(`DROP INDEX IF EXISTS "conversion"."IDX_personal_patterns_guest_owner"`);
    await queryRunner.query(`ALTER TABLE "conversion"."personal_patterns" DROP CONSTRAINT "CHK_personal_patterns_owner", DROP CONSTRAINT "FK_personal_patterns_guest", DROP COLUMN "guest_installation_id", ALTER COLUMN "owner_account_id" SET NOT NULL`);
  }
}
