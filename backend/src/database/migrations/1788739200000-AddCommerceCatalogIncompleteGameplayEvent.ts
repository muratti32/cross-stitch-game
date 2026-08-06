import type { MigrationInterface, QueryRunner } from 'typeorm';

const COMMERCE_STORE_KINDS = [
  'session_started',
  'session_completed',
  'daily_task_completed',
  'pattern_conversion_started',
  'pattern_conversion_completed',
  'pattern_conversion_failed',
  'ai_generation_started',
  'ai_generation_prompt_blocked',
  'ai_generation_completed',
  'ai_generation_failed',
  'purchase_started',
  'purchase_completed',
  'purchase_cancelled',
  'purchase_failed',
  'commerce_store_viewed',
  'commerce_product_selected',
  'purchase_reconciliation_pending',
] as const;

const COMMERCE_CATALOG_INCOMPLETE_KINDS = [
  ...COMMERCE_STORE_KINDS,
  'commerce_catalog_incomplete',
] as const;

export class AddCommerceCatalogIncompleteGameplayEvent1788739200000
  implements MigrationInterface
{
  readonly name = 'AddCommerceCatalogIncompleteGameplayEvent1788739200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await replaceKindConstraint(queryRunner, COMMERCE_CATALOG_INCOMPLETE_KINDS);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await replaceKindConstraint(queryRunner, COMMERCE_STORE_KINDS);
  }
}

async function replaceKindConstraint(
  queryRunner: QueryRunner,
  kinds: readonly string[],
): Promise<void> {
  const quotedKinds = kinds.map((kind) => `'${kind}'`).join(', ');
  await queryRunner.query(
    'ALTER TABLE "analytics"."gameplay_events" '
      + 'DROP CONSTRAINT "CHK_analytics_gameplay_events_kind"',
  );
  await queryRunner.query(
    'ALTER TABLE "analytics"."gameplay_events" '
      + 'ADD CONSTRAINT "CHK_analytics_gameplay_events_kind" '
      + `CHECK ("kind" IN (${quotedKinds}))`,
  );
}
