import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFederatedAuthIdentities1784419200000
  implements MigrationInterface
{
  readonly name = 'AddFederatedAuthIdentities1784419200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auth"."auth_identities"
      DROP CONSTRAINT "UQ_auth_identities_provider_email"
    `);
    await queryRunner.query(`
      ALTER TABLE "auth"."auth_identities"
      DROP CONSTRAINT "CHK_auth_identities_provider"
    `);
    await queryRunner.query(`
      ALTER TABLE "auth"."auth_identities"
      ALTER COLUMN "email" DROP NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "auth"."auth_identities"
      ADD CONSTRAINT "CHK_auth_identities_provider"
      CHECK ("provider" IN ('email', 'google', 'apple'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auth"."auth_identities"
      DROP CONSTRAINT "CHK_auth_identities_provider"
    `);
    await queryRunner.query(`
      ALTER TABLE "auth"."auth_identities"
      ALTER COLUMN "email" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "auth"."auth_identities"
      ADD CONSTRAINT "CHK_auth_identities_provider"
      CHECK ("provider" = 'email')
    `);
    await queryRunner.query(`
      ALTER TABLE "auth"."auth_identities"
      ADD CONSTRAINT "UQ_auth_identities_provider_email"
      UNIQUE ("provider", "email")
    `);
  }
}
