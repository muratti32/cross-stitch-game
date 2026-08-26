export type AnalyticsGameplayEventKind =
  | 'session_started'
  | 'session_completed'
  | 'daily_task_completed'
  | 'pattern_conversion_started'
  | 'pattern_conversion_completed'
  | 'pattern_conversion_failed'
  | 'ai_generation_started'
  | 'ai_generation_prompt_blocked'
  | 'ai_generation_completed'
  | 'ai_generation_failed'
  | 'commerce_store_viewed'
  | 'commerce_product_selected'
  | 'commerce_catalog_incomplete'
  | 'purchase_started'
  | 'purchase_reconciliation_pending'
  | 'purchase_completed'
  | 'purchase_cancelled'
  | 'purchase_failed'
  | 'subscription_change_started'
  | 'subscription_change_completed'
  | 'subscription_change_cancelled'
  | 'subscription_change_failed'
  | 'onboarding_started'
  | 'onboarding_step_viewed'
  | 'onboarding_handedness_selected'
  | 'onboarding_start_choice'
  | 'stitching_session_started'
  | 'tutorial_beat_started'
  | 'tutorial_beat_completed'
  | 'tutorial_hint_shown'
  | 'tutorial_paused'
  | 'tutorial_resumed'
  | 'onboarding_finished'
  | 'account_soft_prompt_shown'
  | 'account_soft_prompt_action';

export type OnboardingVersion = string;
export type OnboardingStep = 'welcome' | 'tutorial' | 'recap';
export type OnboardingHandedness = 'left' | 'right';
export type OnboardingStartChoice = 'start_stitching' | 'browse_starters' | 'sign_in';
export type OnboardingOutcome = 'completed' | 'deferred';
export type OnboardingDestination = 'stitching' | 'catalog' | 'sign_in';
export type TutorialHintId = 'anchored_zoom' | 'pan_vs_sweep' | 'edge_auto_pan' | 'remaining_cell_locator';
export type AccountSoftPromptContext = 'welcome' | 'tutorial' | 'recap';
export type AccountSoftPromptAction = 'sign_in' | 'dismissed';
export type OnboardingPayloadBase = { onboarding_version: OnboardingVersion };

export type DailyTaskKey = 'cells_100' | 'three_colors_10' | 'color_completion';
export type ArtworkSourceKind = 'photo_artwork' | 'ai_artwork';
export type ConversionProfile = 'easy' | 'standard' | 'detailed' | 'custom';
export type ArtworkAspect = 'square' | 'portrait_4_3' | 'landscape_4_3';
export type ConversionFailureStage = 'upload' | 'conversion_engine' | 'delivery';
export type AiGenerationFailureStage =
  | 'prompt_safety'
  | 'provider_submission'
  | 'provider_safety'
  | 'delivery';
export type PurchaseProductKind =
  | 'premium_membership'
  | 'ai_credit_pack'
  | 'stitch_coin_pack';
export type PurchaseProductKey =
  | 'premium_weekly'
  | 'premium_monthly'
  | 'premium_annual'
  | 'ai_credit_pack_5'
  | 'ai_credit_pack_20'
  | 'ai_credit_pack_50'
  | 'coin_pack_300'
  | 'coin_pack_900'
  | 'coin_pack_2000';
export type CommerceEntrySource =
  | 'profile'
  | 'stitch_coin_shortfall'
  | 'ai_credit_shortfall'
  | 'premium_benefit'
  | 'sign_in_return'
  | 'direct';
export type PurchaseFailureStage = 'store' | 'verification' | 'grant';
export type SubscriptionChangePlatform = 'ios' | 'android';
export type SubscriptionChangeFailureStage = 'store' | 'verification' | 'grant';

type PurchasePayload = {
  product_kind: PurchaseProductKind;
  product_key: PurchaseProductKey;
};

// No account, subscriber, transaction, or Support Reference identifiers: only
// the plan pair and platform (issue #121's plan-change analytics rule).
type SubscriptionChangePayload = {
  source_plan: PurchaseProductKey;
  target_plan: PurchaseProductKey;
  platform: SubscriptionChangePlatform;
};

export type AnalyticsGameplayEventPayload =
  | { kind: 'session_started'; payload: { session_id: string } }
  | { kind: 'session_completed'; payload: { session_id: string } }
  | { kind: 'daily_task_completed'; payload: { task_key: DailyTaskKey } }
  | {
      kind: 'pattern_conversion_started';
      payload: { source_artwork_kind: ArtworkSourceKind; conversion_profile: ConversionProfile };
    }
  | {
      kind: 'pattern_conversion_completed';
      payload: { source_artwork_kind: ArtworkSourceKind };
    }
  | {
      kind: 'pattern_conversion_failed';
      payload: { source_artwork_kind: ArtworkSourceKind; failure_stage: ConversionFailureStage };
    }
  | { kind: 'ai_generation_started'; payload: { aspect: ArtworkAspect } }
  | { kind: 'ai_generation_prompt_blocked'; payload: Record<string, never> }
  | { kind: 'ai_generation_completed'; payload: { aspect: ArtworkAspect } }
  | { kind: 'ai_generation_failed'; payload: { failure_stage: AiGenerationFailureStage } }
  | { kind: 'commerce_store_viewed'; payload: { source: CommerceEntrySource } }
  | { kind: 'commerce_product_selected'; payload: PurchasePayload }
  | { kind: 'commerce_catalog_incomplete'; payload: PurchasePayload }
  | { kind: 'purchase_started'; payload: PurchasePayload }
  | { kind: 'purchase_reconciliation_pending'; payload: PurchasePayload }
  | { kind: 'purchase_completed'; payload: PurchasePayload }
  | { kind: 'purchase_cancelled'; payload: PurchasePayload }
  | {
      kind: 'purchase_failed';
      payload: PurchasePayload & { failure_stage: PurchaseFailureStage };
    }
  | { kind: 'subscription_change_started'; payload: SubscriptionChangePayload }
  | { kind: 'subscription_change_completed'; payload: SubscriptionChangePayload }
  | { kind: 'subscription_change_cancelled'; payload: SubscriptionChangePayload }
  | {
      kind: 'subscription_change_failed';
      payload: SubscriptionChangePayload & { failure_stage: SubscriptionChangeFailureStage };
    }
  | { kind: 'onboarding_started'; payload: OnboardingPayloadBase & { is_resume: boolean } }
  | { kind: 'onboarding_step_viewed'; payload: OnboardingPayloadBase & { step: OnboardingStep; is_resume: boolean } }
  | { kind: 'onboarding_handedness_selected'; payload: OnboardingPayloadBase & { handedness: OnboardingHandedness; was_default: boolean } }
  | { kind: 'onboarding_start_choice'; payload: OnboardingPayloadBase & { choice: OnboardingStartChoice } }
  | { kind: 'stitching_session_started'; payload: OnboardingPayloadBase & { session_id: string; pattern_id: string; pattern_source: 'bundled'; source: 'onboarding' } }
  | { kind: 'tutorial_beat_started'; payload: OnboardingPayloadBase & { beat_id: string; beat_number: number } }
  | { kind: 'tutorial_beat_completed'; payload: OnboardingPayloadBase & { beat_id: string; elapsed_ms: number; attempt_count: number; auto_satisfied: boolean } }
  | { kind: 'tutorial_hint_shown'; payload: OnboardingPayloadBase & { hint_id: TutorialHintId; trigger: string } }
  | { kind: 'tutorial_paused'; payload: OnboardingPayloadBase & { beat_id: string; destination: string } }
  | { kind: 'tutorial_resumed'; payload: OnboardingPayloadBase & { beat_id: string; resume_source: string } }
  | { kind: 'onboarding_finished'; payload: OnboardingPayloadBase & { outcome: OnboardingOutcome; destination: OnboardingDestination; duration_ms: number; stitch_count: number } }
  | { kind: 'account_soft_prompt_shown'; payload: OnboardingPayloadBase & { context: AccountSoftPromptContext } }
  | { kind: 'account_soft_prompt_action'; payload: OnboardingPayloadBase & { context: AccountSoftPromptContext; action: AccountSoftPromptAction } };

export interface AnalyticsGameplayEvent {
  eventId: string;
  occurredAt: string;
  kind: AnalyticsGameplayEventKind;
  payload: AnalyticsGameplayEventPayload['payload'];
  dedupeKey?: string;
}
