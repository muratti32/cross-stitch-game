import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdAttempts1785715200000 implements MigrationInterface {
  readonly name = 'CreateAdAttempts1785715200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "economy"."ad_attempts" (
        "nonce" uuid NOT NULL DEFAULT gen_random_uuid(),
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "placement" varchar(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ad_attempts" PRIMARY KEY ("nonce"),
        CONSTRAINT "CHK_ad_attempts_principal_type" CHECK ("principal_type" IN ('guest', 'account'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_ad_attempts_principal_created"
      ON "economy"."ad_attempts" ("principal_type", "principal_id", "created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "economy"."IDX_ad_attempts_principal_created"');
    await queryRunner.query('DROP TABLE IF EXISTS "economy"."ad_attempts"');
  }
}
