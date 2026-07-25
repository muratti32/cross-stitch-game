import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvalidatedNamespaceTokens1787270400000
  implements MigrationInterface
{
  readonly name = 'CreateInvalidatedNamespaceTokens1787270400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "deletion"."invalidated_namespace_tokens" (
        "token_hash" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "expires_at" timestamptz NOT NULL,
        CONSTRAINT "PK_invalidated_namespace_tokens" PRIMARY KEY ("token_hash")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_invalidated_namespace_tokens_expires_at"
      ON "deletion"."invalidated_namespace_tokens" ("expires_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "deletion"."IDX_invalidated_namespace_tokens_expires_at"
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS "deletion"."invalidated_namespace_tokens"
    `);
  }
}
