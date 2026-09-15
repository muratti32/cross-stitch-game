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
  'onboarding_started', 'onboarding_step_viewed', 'onboarding_handedness_selected',
  'onboarding_start_choice', 'stitching_session_started', 'tutorial_beat_started',
  'tutorial_beat_completed', 'tutorial_hint_shown', 'tutorial_paused', 'tutorial_resumed',
  'onboarding_finished', 'account_soft_prompt_shown', 'account_soft_prompt_action',
  'render_stop_exposure',
] as const;

const ADDED = [
  'unlock_prompt_shown',
  'pattern_unlocked',
  'unlock_insufficient_coins',
  'unlock_get_coins_tapped',
] as const;

export class AddPatternUnlockGameplayEvents1792972800000 implements MigrationInterface {
  readonly name = 'AddPatternUnlockGameplayEvents1792972800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await replace(queryRunner, [...PREVIOUS, ...ADDED]);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await replace(queryRunner, PREVIOUS);
  }
}

async function replace(queryRunner: QueryRunner, kinds: readonly string[]): Promise<void> {
  const values = kinds.map((kind) => `'${kind}'`).join(', ');
  await queryRunner.query('ALTER TABLE "analytics"."gameplay_events" DROP CONSTRAINT "CHK_analytics_gameplay_events_kind"');
  await queryRunner.query(`ALTER TABLE "analytics"."gameplay_events" ADD CONSTRAINT "CHK_analytics_gameplay_events_kind" CHECK ("kind" IN (${values}))`);
}
