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
  | 'purchase_failed';

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

type PurchasePayload = {
  product_kind: PurchaseProductKind;
  product_key: PurchaseProductKey;
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
    };

export interface AnalyticsGameplayEvent {
  eventId: string;
  occurredAt: string;
  kind: AnalyticsGameplayEventKind;
  payload: AnalyticsGameplayEventPayload['payload'];
  dedupeKey?: string;
}
