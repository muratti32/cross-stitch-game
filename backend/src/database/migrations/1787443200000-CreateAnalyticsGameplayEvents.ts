import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAnalyticsGameplayEvents1787443200000
  implements MigrationInterface
{
  readonly name = 'CreateAnalyticsGameplayEvents1787443200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE SCHEMA IF NOT EXISTS "analytics"');
    // Idempotency rides on the (event_id, occurred_at) primary key below, which
    // is dropped along with its partition. There is deliberately no separate
    // event-id registry: an unpartitioned one would outlive every partition and
    // grow without bound, which is exactly what retention has to prevent.
    await queryRunner.query(`
      CREATE TABLE "analytics"."gameplay_events" (
        "event_id" uuid NOT NULL,
        "occurred_at" timestamptz NOT NULL,
        "principal_type" varchar(16) NOT NULL,
        "principal_id" uuid NOT NULL,
        "kind" varchar(64) NOT NULL,
        "payload" jsonb NOT NULL,
        "received_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_analytics_gameplay_events" PRIMARY KEY ("event_id", "occurred_at"),
        CONSTRAINT "CHK_analytics_gameplay_events_principal_type"
          CHECK ("principal_type" IN ('guest', 'account')),
        CONSTRAINT "CHK_analytics_gameplay_events_kind"
          CHECK ("kind" IN (
            'session_started', 'session_completed', 'daily_task_completed',
            'pattern_conversion_started', 'pattern_conversion_completed',
            'pattern_conversion_failed', 'ai_generation_started',
            'ai_generation_prompt_blocked', 'ai_generation_completed',
            'ai_generation_failed', 'purchase_started', 'purchase_completed',
            'purchase_cancelled', 'purchase_failed'
          ))
      ) PARTITION BY RANGE ("occurred_at")
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION analytics.reject_gameplay_event_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'analytics.gameplay_events is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_analytics_gameplay_events_append_only"
      BEFORE UPDATE OR DELETE ON "analytics"."gameplay_events"
      FOR EACH ROW EXECUTE FUNCTION analytics.reject_gameplay_event_mutation()
    `);
    await queryRunner.query(`
      DO $$
      DECLARE
        partition_month date;
        next_month date;
        partition_name text;
      BEGIN
        FOR offset_months IN 0..1 LOOP
          partition_month := (date_trunc('month', now()) + (offset_months || ' months')::interval)::date;
          next_month := (partition_month + interval '1 month')::date;
          partition_name := format('gameplay_events_%s', to_char(partition_month, 'YYYY_MM'));
          EXECUTE format(
            'CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.gameplay_events FOR VALUES FROM (%L) TO (%L)',
            partition_name,
            partition_month,
            next_month
          );
        END LOOP;
      END
      $$
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_analytics_gameplay_events_kind_occurred_at" ON "analytics"."gameplay_events" ("kind", "occurred_at")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "analytics"."gameplay_events" CASCADE');
    await queryRunner.query('DROP FUNCTION IF EXISTS analytics.reject_gameplay_event_mutation()');
  }
}
