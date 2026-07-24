import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProfileReports1786320000000 implements MigrationInterface {
  readonly name = 'CreateProfileReports1786320000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // A human case opened behind one or more Profile Reports. At most one case
    // per profile is open at a time (partial unique index below), so repeat
    // reports attach to the same case instead of multiplying it.
    await queryRunner.query(`
      CREATE TABLE "moderation"."profile_investigations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "profile_id" uuid NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'open',
        "profile_version_at_open" integer NOT NULL,
        "report_count" integer NOT NULL DEFAULT 0,
        "opened_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "closed_at" timestamptz,
        "closed_by" uuid,
        "close_outcome" varchar(32),
        CONSTRAINT "PK_profile_investigations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_profile_investigations_profile"
          FOREIGN KEY ("profile_id") REFERENCES "moderation"."creator_profiles" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_profile_investigations_closed_by"
          FOREIGN KEY ("closed_by") REFERENCES "admin"."operator_accounts" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_profile_investigations_status"
          CHECK ("status" IN ('open', 'closed')),
        CONSTRAINT "CHK_profile_investigations_version" CHECK ("profile_version_at_open" > 0),
        CONSTRAINT "CHK_profile_investigations_report_count" CHECK ("report_count" >= 0),
        CONSTRAINT "CHK_profile_investigations_closed"
          CHECK (
            ("status" = 'open' AND "closed_at" IS NULL AND "closed_by" IS NULL AND "close_outcome" IS NULL)
            OR
            ("status" = 'closed' AND "closed_at" IS NOT NULL)
          )
      )
    `);
    // Only one open case may exist per profile at a time.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_profile_investigations_open"
      ON "moderation"."profile_investigations" ("profile_id")
      WHERE "status" = 'open'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_profile_investigations_review_queue"
      ON "moderation"."profile_investigations" ("status", "opened_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_profile_investigations_profile"
      ON "moderation"."profile_investigations" ("profile_id", "opened_at" DESC)
    `);

    // One Profile Report per submitting account and open case (unique below),
    // so a repeat during that open case returns the existing report.
    await queryRunner.query(`
      CREATE TABLE "moderation"."profile_reports" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "investigation_id" uuid NOT NULL,
        "profile_id" uuid NOT NULL,
        "reporter_account_id" uuid NOT NULL,
        "reason_code" varchar(32) NOT NULL,
        "note" varchar(1000),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_profile_reports" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_profile_reports_reporter_investigation"
          UNIQUE ("investigation_id", "reporter_account_id"),
        CONSTRAINT "FK_profile_reports_investigation"
          FOREIGN KEY ("investigation_id") REFERENCES "moderation"."profile_investigations" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_profile_reports_profile"
          FOREIGN KEY ("profile_id") REFERENCES "moderation"."creator_profiles" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_profile_reports_reporter"
          FOREIGN KEY ("reporter_account_id") REFERENCES "auth"."registered_accounts" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_profile_reports_reason_code"
          CHECK ("reason_code" IN ('impersonation', 'offensive', 'spam', 'other'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_profile_reports_investigation"
      ON "moderation"."profile_reports" ("investigation_id", "created_at")
    `);

    // The moderation-event stream of the Creator Profile Audit: report and
    // case-open (and later close/remediation/restriction) events with actor,
    // reason, and time. Distinct from creator_profile_audit, which snapshots
    // profile VALUES per version; these rows are not tied to a version.
    await queryRunner.query(`
      CREATE TABLE "moderation"."creator_profile_audit_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "profile_id" uuid NOT NULL,
        "investigation_id" uuid,
        "report_id" uuid,
        "event_type" varchar(48) NOT NULL,
        "actor_type" varchar(16) NOT NULL,
        "actor_id" uuid,
        "reason" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_creator_profile_audit_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_creator_profile_audit_events_profile"
          FOREIGN KEY ("profile_id") REFERENCES "moderation"."creator_profiles" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_creator_profile_audit_events_investigation"
          FOREIGN KEY ("investigation_id") REFERENCES "moderation"."profile_investigations" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_creator_profile_audit_events_report"
          FOREIGN KEY ("report_id") REFERENCES "moderation"."profile_reports" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "CHK_creator_profile_audit_events_actor_type"
          CHECK ("actor_type" IN ('account', 'operator', 'system')),
        CONSTRAINT "CHK_creator_profile_audit_events_actor"
          CHECK ("actor_type" = 'system' OR "actor_id" IS NOT NULL)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_creator_profile_audit_events_profile"
      ON "moderation"."creator_profile_audit_events" ("profile_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE FUNCTION "moderation"."reject_creator_profile_audit_event_mutation"()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Creator Profile Audit is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_creator_profile_audit_events_append_only"
      BEFORE UPDATE OR DELETE ON "moderation"."creator_profile_audit_events"
      FOR EACH ROW EXECUTE FUNCTION "moderation"."reject_creator_profile_audit_event_mutation"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_creator_profile_audit_events_append_only" ON "moderation"."creator_profile_audit_events"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS "moderation"."reject_creator_profile_audit_event_mutation"()',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "moderation"."creator_profile_audit_events"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "moderation"."profile_reports"');
    await queryRunner.query(
      'DROP TABLE IF EXISTS "moderation"."profile_investigations"',
    );
  }
}
