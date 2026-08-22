import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommerceOwnerToTransactionBindings1788912000000
  implements MigrationInterface
{
  readonly name = 'AddCommerceOwnerToTransactionBindings1788912000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add the nullable Registered Account owner column
    await queryRunner.query(`
      ALTER TABLE "economy"."commerce_transaction_bindings"
      ADD COLUMN "account_id" uuid NULL
    `);

    // 2. Add the nullable Guest Installation Identity owner column
    await queryRunner.query(`
      ALTER TABLE "economy"."commerce_transaction_bindings"
      ADD COLUMN "guest_installation_id" uuid NULL
    `);

    // 3. Add the Registered Account foreign key
    await queryRunner.query(`
      ALTER TABLE "economy"."commerce_transaction_bindings"
      ADD CONSTRAINT "FK_commerce_transaction_bindings_account"
      FOREIGN KEY ("account_id")
      REFERENCES "auth"."registered_accounts" ("id")
    `);

    // 4. Add the Guest Installation Identity foreign key
    await queryRunner.query(`
      ALTER TABLE "economy"."commerce_transaction_bindings"
      ADD CONSTRAINT "FK_commerce_transaction_bindings_guest_installation"
      FOREIGN KEY ("guest_installation_id")
      REFERENCES "auth"."guest_installations" ("id")
    `);

    // 5. Backfill existing account owners without changing existing principal data
    await queryRunner.query(`
      UPDATE "economy"."commerce_transaction_bindings"
      SET "account_id" = "principal_id"
      WHERE "principal_type" = 'account' AND "account_id" IS NULL
    `);

    // 6. Widen the principal type check to include Guest Installation Identity owners
    await queryRunner.query(`
      ALTER TABLE "economy"."commerce_transaction_bindings"
      DROP CONSTRAINT "CHK_commerce_transaction_bindings_principal_type"
    `);

    await queryRunner.query(`
      ALTER TABLE "economy"."commerce_transaction_bindings"
      ADD CONSTRAINT "CHK_commerce_transaction_bindings_principal_type"
      CHECK ("principal_type" IN ('account', 'guest'))
    `);

    // 7. Enforce exactly one owner and consistency with principal_type/principal_id
    await queryRunner.query(`
      ALTER TABLE "economy"."commerce_transaction_bindings"
      ADD CONSTRAINT "CHK_commerce_transaction_bindings_owner"
      CHECK (
        ("principal_type" = 'account' AND "account_id" = "principal_id" AND "guest_installation_id" IS NULL)
        OR
        ("principal_type" = 'guest' AND "guest_installation_id" = "principal_id" AND "account_id" IS NULL)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the owner consistency check
    await queryRunner.query(`
      ALTER TABLE "economy"."commerce_transaction_bindings"
      DROP CONSTRAINT "CHK_commerce_transaction_bindings_owner"
    `);

    // 2. Drop the widened principal type check
    await queryRunner.query(`
      ALTER TABLE "economy"."commerce_transaction_bindings"
      DROP CONSTRAINT "CHK_commerce_transaction_bindings_principal_type"
    `);

    // 3. Drop the Guest Installation Identity foreign key
    await queryRunner.query(`
      ALTER TABLE "economy"."commerce_transaction_bindings"
      DROP CONSTRAINT "FK_commerce_transaction_bindings_guest_installation"
    `);

    // 4. Drop the Registered Account foreign key
    await queryRunner.query(`
      ALTER TABLE "economy"."commerce_transaction_bindings"
      DROP CONSTRAINT "FK_commerce_transaction_bindings_account"
    `);

    // 5. Restore the original Registered Account-only principal type check
    await queryRunner.query(`
      ALTER TABLE "economy"."commerce_transaction_bindings"
      ADD CONSTRAINT "CHK_commerce_transaction_bindings_principal_type"
      CHECK ("principal_type" = 'account')
    `);

    // 6. Remove the owner columns without attempting to un-backfill data
    await queryRunner.query(`
      ALTER TABLE "economy"."commerce_transaction_bindings"
      DROP COLUMN "guest_installation_id",
      DROP COLUMN "account_id"
    `);
  }
}
