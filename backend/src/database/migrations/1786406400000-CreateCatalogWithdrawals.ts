import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCatalogWithdrawals1786406400000 implements MigrationInterface {
  readonly name = 'CreateCatalogWithdrawals1786406400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "catalog"."catalog_withdrawals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "community_pattern_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "creator_profile_id" uuid NOT NULL,
        "previous_status" varchar(16) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_withdrawals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_catalog_withdrawals_pattern" UNIQUE ("community_pattern_id"),
        CONSTRAINT "FK_catalog_withdrawals_pattern" FOREIGN KEY ("community_pattern_id") REFERENCES "catalog"."patterns" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_withdrawals_account" FOREIGN KEY ("account_id") REFERENCES "auth"."registered_accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_catalog_withdrawals_creator_profile" FOREIGN KEY ("creator_profile_id") REFERENCES "moderation"."creator_profiles" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_catalog_withdrawals_previous_status" CHECK ("previous_status" = 'available')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_catalog_withdrawals_account_created"
      ON "catalog"."catalog_withdrawals" ("account_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "catalog"."catalog_withdrawal_closures" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "withdrawal_id" uuid NOT NULL,
        "record_type" varchar(32) NOT NULL,
        "record_id" uuid NOT NULL,
        "from_status" varchar(32) NOT NULL,
        "to_status" varchar(32) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_withdrawal_closures" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_catalog_withdrawal_closures_record" UNIQUE ("withdrawal_id", "record_type", "record_id"),
        CONSTRAINT "FK_catalog_withdrawal_closures_withdrawal" FOREIGN KEY ("withdrawal_id") REFERENCES "catalog"."catalog_withdrawals" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_catalog_withdrawal_closures_record_type" CHECK ("record_type" IN ('metadata_revision', 'metadata_appeal'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_catalog_withdrawal_closures_withdrawal"
      ON "catalog"."catalog_withdrawal_closures" ("withdrawal_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE FUNCTION "catalog"."reject_catalog_withdrawal_history_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Catalog Withdrawal history is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_catalog_withdrawals_append_only"
      BEFORE UPDATE OR DELETE ON "catalog"."catalog_withdrawals"
      FOR EACH ROW EXECUTE FUNCTION "catalog"."reject_catalog_withdrawal_history_mutation"()
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_catalog_withdrawal_closures_append_only"
      BEFORE UPDATE OR DELETE ON "catalog"."catalog_withdrawal_closures"
      FOR EACH ROW EXECUTE FUNCTION "catalog"."reject_catalog_withdrawal_history_mutation"()
    `);

    await queryRunner.query(`
      CREATE FUNCTION "catalog"."reject_withdrawn_community_pattern_restore"()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."status" = 'available'
          AND OLD."status" <> 'available'
          AND NEW."creator_profile_id" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "catalog"."catalog_withdrawals" withdrawal
            WHERE withdrawal."community_pattern_id" = NEW."id"
          ) THEN
          RAISE EXCEPTION 'Catalog Withdrawal is irreversible for a Community Pattern';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_patterns_reject_community_restore"
      BEFORE UPDATE OF "status" ON "catalog"."patterns"
      FOR EACH ROW EXECUTE FUNCTION "catalog"."reject_withdrawn_community_pattern_restore"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_patterns_reject_community_restore" ON "catalog"."patterns"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS "catalog"."reject_withdrawn_community_pattern_restore"()',
    );
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_catalog_withdrawal_closures_append_only" ON "catalog"."catalog_withdrawal_closures"',
    );
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_catalog_withdrawals_append_only" ON "catalog"."catalog_withdrawals"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS "catalog"."reject_catalog_withdrawal_history_mutation"()',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "catalog"."IDX_catalog_withdrawal_closures_withdrawal"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "catalog"."catalog_withdrawal_closures"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "catalog"."IDX_catalog_withdrawals_account_created"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "catalog"."catalog_withdrawals"');
  }
}
