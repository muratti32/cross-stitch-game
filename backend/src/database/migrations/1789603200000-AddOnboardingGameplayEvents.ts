import type { MigrationInterface, QueryRunner } from 'typeorm';

const PREVIOUS = [
  'session_started', 'session_completed', 'daily_task_completed',
  'pattern_conversion_started', 'pattern_conversion_completed', 'pattern_conversion_failed',
  'ai_generation_started', 'ai_generation_prompt_blocked', 'ai_generation_completed',
  'ai_generation_failed', 'purchase_started', 'purchase_completed', 'purchase_cancelled',
  'purchase_failed', 'commerce_store_viewed', 'commerce_product_selected',
  'purchase_reconciliation_pending', 'commerce_catalog_incomplete',
  'subscription_change_started', 'subscription_change_completed',
  'subscription_change_cancelled', 'subscription_change_failed',
] as const;
const ONBOARDING = [
  'onboarding_started', 'onboarding_step_viewed', 'onboarding_handedness_selected',
  'onboarding_start_choice', 'stitching_session_started', 'tutorial_beat_started',
  'tutorial_beat_completed', 'tutorial_hint_shown', 'tutorial_paused', 'tutorial_resumed',
  'onboarding_finished', 'account_soft_prompt_shown', 'account_soft_prompt_action',
] as const;

export class AddOnboardingGameplayEvents1789603200000 implements MigrationInterface {
  readonly name = 'AddOnboardingGameplayEvents1789603200000';
  async up(queryRunner: QueryRunner): Promise<void> { await replace(queryRunner, [...PREVIOUS, ...ONBOARDING]); }
  async down(queryRunner: QueryRunner): Promise<void> { await replace(queryRunner, PREVIOUS); }
}

async function replace(queryRunner: QueryRunner, kinds: readonly string[]): Promise<void> {
  const values = kinds.map((kind) => `'${kind}'`).join(', ');
  await queryRunner.query('ALTER TABLE "analytics"."gameplay_events" DROP CONSTRAINT "CHK_analytics_gameplay_events_kind"');
  await queryRunner.query(`ALTER TABLE "analytics"."gameplay_events" ADD CONSTRAINT "CHK_analytics_gameplay_events_kind" CHECK ("kind" IN (${values}))`);
}
