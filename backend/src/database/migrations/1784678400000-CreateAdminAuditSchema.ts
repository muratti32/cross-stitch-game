import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminAuditSchema1784678400000
  implements MigrationInterface
{
  readonly name = 'CreateAdminAuditSchema1784678400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Shared trigger function enforcing append-only tables at the database
    // level: no UPDATE or DELETE can ever remove or rewrite audit evidence,
    // even from a bug or a compromised application credential.
    await queryRunner.query(`
      CREATE FUNCTION "admin"."forbid_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);

    // Every mutation to Operator Console state writes one of these rows in
    // the same transaction as the domain mutation it records.
    await queryRunner.query(`
      CREATE TABLE "admin"."operator_audit_log" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "operator_account_id" uuid NOT NULL,
        "action" varchar(128) NOT NULL,
        "target_type" varchar(64) NOT NULL,
        "target_id" varchar(128),
        "before" jsonb,
        "after" jsonb,
        "request_id" varchar(128),
        "outcome" varchar(16) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_operator_audit_log" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_operator_audit_log_outcome" CHECK ("outcome" IN ('success', 'failure')),
        CONSTRAINT "FK_operator_audit_log_account"
          FOREIGN KEY ("operator_account_id")
          REFERENCES "admin"."operator_accounts" ("id")
          ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_operator_audit_log_account_created"
      ON "admin"."operator_audit_log" ("operator_account_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_operator_audit_log_target"
      ON "admin"."operator_audit_log" ("target_type", "target_id")
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_operator_audit_log_append_only"
      BEFORE UPDATE OR DELETE ON "admin"."operator_audit_log"
      FOR EACH ROW EXECUTE FUNCTION "admin"."forbid_mutation"()
    `);

    // Security events are committed independently of any domain transaction
    // (own dataSource.manager write, never inside a caller's transaction) so
    // a rolled-back mutation can never erase evidence of a security event.
    await queryRunner.query(`
      CREATE TABLE "admin"."operator_security_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "operator_account_id" uuid,
        "event_type" varchar(64) NOT NULL,
        "detail" jsonb,
        "ip" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_operator_security_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_operator_security_events_account"
          FOREIGN KEY ("operator_account_id")
          REFERENCES "admin"."operator_accounts" ("id")
          ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_operator_security_events_account_created"
      ON "admin"."operator_security_events" ("operator_account_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_operator_security_events_type_created"
      ON "admin"."operator_security_events" ("event_type", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_operator_security_events_append_only"
      BEFORE UPDATE OR DELETE ON "admin"."operator_security_events"
      FOR EACH ROW EXECUTE FUNCTION "admin"."forbid_mutation"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TRG_operator_security_events_append_only" ON "admin"."operator_security_events"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "admin"."operator_security_events"');
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TRG_operator_audit_log_append_only" ON "admin"."operator_audit_log"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "admin"."operator_audit_log"');
    await queryRunner.query('DROP FUNCTION IF EXISTS "admin"."forbid_mutation"()');
  }
}
