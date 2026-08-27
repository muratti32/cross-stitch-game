import { BadRequestException } from '@nestjs/common';

export const GAMEPLAY_EVENT_KINDS = [
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
  'commerce_store_viewed',
  'commerce_product_selected',
  'commerce_catalog_incomplete',
  'purchase_started',
  'purchase_reconciliation_pending',
  'purchase_completed',
  'purchase_cancelled',
  'purchase_failed',
  'subscription_change_started',
  'subscription_change_completed',
  'subscription_change_cancelled',
  'subscription_change_failed',
  'onboarding_started',
  'onboarding_step_viewed',
  'onboarding_handedness_selected',
  'onboarding_start_choice',
  'stitching_session_started',
  'tutorial_beat_started',
  'tutorial_beat_completed',
  'tutorial_hint_shown',
  'tutorial_paused',
  'tutorial_resumed',
  'onboarding_finished',
  'account_soft_prompt_shown',
  'account_soft_prompt_action',
] as const;

export type GameplayEventKind = (typeof GAMEPLAY_EVENT_KINDS)[number];

type SessionPayload = { session_id: string };
type DailyTaskPayload = {
  task_key: 'cells_100' | 'three_colors_10' | 'color_completion';
};
type PatternConversionStartedPayload = {
  source_artwork_kind: 'photo_artwork' | 'ai_artwork';
  conversion_profile: 'easy' | 'standard' | 'detailed' | 'custom';
};
type PatternConversionCompletedPayload = {
  source_artwork_kind: 'photo_artwork' | 'ai_artwork';
};
type PatternConversionFailedPayload = {
  source_artwork_kind: 'photo_artwork' | 'ai_artwork';
  failure_stage: 'upload' | 'conversion_engine' | 'delivery';
};
type AiGenerationStartedPayload = {
  aspect: 'square' | 'portrait_4_3' | 'landscape_4_3';
};
type AiGenerationFailedPayload = {
  failure_stage:
    | 'prompt_safety'
    | 'provider_submission'
    | 'provider_safety'
    | 'delivery';
};
type PurchasePayload = {
  product_kind: 'premium_membership' | 'ai_credit_pack' | 'stitch_coin_pack';
  product_key:
    | 'premium_weekly'
    | 'premium_monthly'
    | 'premium_annual'
    | 'ai_credit_pack_5'
    | 'ai_credit_pack_20'
    | 'ai_credit_pack_50'
    | 'coin_pack_300'
    | 'coin_pack_900'
    | 'coin_pack_2000';
};
type CommerceStoreViewedPayload = {
  source:
    | 'profile'
    | 'stitch_coin_shortfall'
    | 'ai_credit_shortfall'
    | 'premium_benefit'
    | 'sign_in_return'
    | 'direct';
};
type PurchaseFailedPayload = PurchasePayload & {
  failure_stage: 'store' | 'verification' | 'grant';
};
// No account, subscriber, transaction, or Support Reference identifiers: only
// the plan pair and platform (issue #121's plan-change analytics rule).
type SubscriptionChangePayload = {
  source_plan: 'premium_weekly' | 'premium_monthly' | 'premium_annual';
  target_plan: 'premium_weekly' | 'premium_monthly' | 'premium_annual';
  platform: 'ios' | 'android';
};
type SubscriptionChangeFailedPayload = SubscriptionChangePayload & {
  failure_stage: 'store' | 'verification' | 'grant';
};
type OnboardingBase = { onboarding_version: string };
type OnboardingPayload = OnboardingBase & Record<string, unknown>;

export type GameplayEventPayload =
  | SessionPayload
  | DailyTaskPayload
  | PatternConversionStartedPayload
  | PatternConversionCompletedPayload
  | PatternConversionFailedPayload
  | AiGenerationStartedPayload
  | AiGenerationFailedPayload
  | CommerceStoreViewedPayload
  | PurchasePayload
  | PurchaseFailedPayload
  | SubscriptionChangePayload
  | SubscriptionChangeFailedPayload
  | Record<string, never>
  | OnboardingPayload;

type PayloadRule = {
  readonly allowedFields: readonly string[];
  readonly validate: (payload: Record<string, unknown>) => boolean;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DAILY_TASK_KEYS = new Set(['cells_100', 'three_colors_10', 'color_completion']);
const SOURCE_ARTWORK_KINDS = new Set(['photo_artwork', 'ai_artwork']);
const CONVERSION_PROFILES = new Set(['easy', 'standard', 'detailed', 'custom']);
const ARTWORK_ASPECTS = new Set(['square', 'portrait_4_3', 'landscape_4_3']);
const CONVERSION_FAILURE_STAGES = new Set(['upload', 'conversion_engine', 'delivery']);
const AI_FAILURE_STAGES = new Set([
  'prompt_safety',
  'provider_submission',
  'provider_safety',
  'delivery',
]);
const PURCHASE_KINDS = new Set([
  'premium_membership',
  'ai_credit_pack',
  'stitch_coin_pack',
]);
const COMMERCE_ENTRY_SOURCES = new Set([
  'profile',
  'stitch_coin_shortfall',
  'ai_credit_shortfall',
  'premium_benefit',
  'sign_in_return',
  'direct',
]);
const PRODUCT_KEYS_BY_KIND: Readonly<Record<string, ReadonlySet<string>>> = {
  premium_membership: new Set(['premium_weekly', 'premium_monthly', 'premium_annual']),
  ai_credit_pack: new Set(['ai_credit_pack_5', 'ai_credit_pack_20', 'ai_credit_pack_50']),
  stitch_coin_pack: new Set(['coin_pack_300', 'coin_pack_900', 'coin_pack_2000']),
};
const PURCHASE_FAILURE_STAGES = new Set(['store', 'verification', 'grant']);
const PREMIUM_PLAN_KEYS = PRODUCT_KEYS_BY_KIND.premium_membership;
const SUBSCRIPTION_CHANGE_PLATFORMS = new Set(['ios', 'android']);

const payloadRules: Readonly<Record<GameplayEventKind, PayloadRule>> = {
  session_started: sessionRule(),
  session_completed: sessionRule(),
  daily_task_completed: {
    allowedFields: ['task_key'],
    validate: (payload) => isMember(payload.task_key, DAILY_TASK_KEYS),
  },
  pattern_conversion_started: {
    allowedFields: ['source_artwork_kind', 'conversion_profile'],
    validate: (payload) =>
      isMember(payload.source_artwork_kind, SOURCE_ARTWORK_KINDS) &&
      isMember(payload.conversion_profile, CONVERSION_PROFILES),
  },
  pattern_conversion_completed: {
    allowedFields: ['source_artwork_kind'],
    validate: (payload) => isMember(payload.source_artwork_kind, SOURCE_ARTWORK_KINDS),
  },
  pattern_conversion_failed: {
    allowedFields: ['source_artwork_kind', 'failure_stage'],
    validate: (payload) =>
      isMember(payload.source_artwork_kind, SOURCE_ARTWORK_KINDS) &&
      isMember(payload.failure_stage, CONVERSION_FAILURE_STAGES),
  },
  ai_generation_started: {
    allowedFields: ['aspect'],
    validate: (payload) => isMember(payload.aspect, ARTWORK_ASPECTS),
  },
  ai_generation_prompt_blocked: emptyPayloadRule(),
  ai_generation_completed: {
    allowedFields: ['aspect'],
    validate: (payload) => isMember(payload.aspect, ARTWORK_ASPECTS),
  },
  ai_generation_failed: {
    allowedFields: ['failure_stage'],
    validate: (payload) => isMember(payload.failure_stage, AI_FAILURE_STAGES),
  },
  commerce_store_viewed: {
    allowedFields: ['source'],
    validate: (payload) => isMember(payload.source, COMMERCE_ENTRY_SOURCES),
  },
  commerce_product_selected: purchaseRule(),
  // A canonical product the Commerce Store expected but the current offering
  // did not return. The catalogue still renders whatever is present, so this is
  // the only signal that a store product is misconfigured or unapproved.
  commerce_catalog_incomplete: purchaseRule(),
  purchase_started: purchaseRule(),
  purchase_reconciliation_pending: purchaseRule(),
  purchase_completed: purchaseRule(),
  purchase_cancelled: purchaseRule(),
  purchase_failed: {
    allowedFields: ['product_kind', 'product_key', 'failure_stage'],
    validate: (payload) =>
      isPurchaseProduct(payload) &&
      isMember(payload.failure_stage, PURCHASE_FAILURE_STAGES),
  },
  subscription_change_started: subscriptionChangeRule(),
  subscription_change_completed: subscriptionChangeRule(),
  subscription_change_cancelled: subscriptionChangeRule(),
  subscription_change_failed: {
    allowedFields: ['source_plan', 'target_plan', 'platform', 'failure_stage'],
    validate: (payload) =>
      isSubscriptionChangeProduct(payload) &&
      isMember(payload.failure_stage, PURCHASE_FAILURE_STAGES),
  },
  onboarding_started: onboardingRule(['is_resume'], p => typeof p.is_resume === 'boolean'),
  onboarding_step_viewed: onboardingRule(['step', 'is_resume'], p => isMember(p.step, new Set(['welcome', 'tutorial', 'recap'])) && typeof p.is_resume === 'boolean'),
  onboarding_handedness_selected: onboardingRule(['handedness', 'was_default'], p => isMember(p.handedness, new Set(['left', 'right'])) && typeof p.was_default === 'boolean'),
  onboarding_start_choice: onboardingRule(['choice'], p => isMember(p.choice, new Set(['start_stitching', 'browse_starters', 'sign_in']))),
  stitching_session_started: onboardingRule(['session_id', 'pattern_id', 'pattern_source', 'source'], p => typeof p.session_id === 'string' && UUID_PATTERN.test(p.session_id as string) && typeof p.pattern_id === 'string' && p.pattern_source === 'bundled' && p.source === 'onboarding'),
  tutorial_beat_started: onboardingRule(['beat_id', 'beat_number'], p => typeof p.beat_id === 'string' && Number.isInteger(p.beat_number) && (p.beat_number as number) > 0),
  tutorial_beat_completed: onboardingRule(['beat_id', 'elapsed_ms', 'attempt_count', 'auto_satisfied'], p => typeof p.beat_id === 'string' && isNonNegativeInteger(p.elapsed_ms) && isNonNegativeInteger(p.attempt_count) && typeof p.auto_satisfied === 'boolean'),
  tutorial_hint_shown: onboardingRule(['hint_id', 'trigger'], p => isMember(p.hint_id, new Set(['anchored_zoom', 'pan_vs_sweep', 'edge_auto_pan', 'remaining_cell_locator'])) && typeof p.trigger === 'string'),
  tutorial_paused: onboardingRule(['beat_id', 'destination'], p => typeof p.beat_id === 'string' && typeof p.destination === 'string'),
  tutorial_resumed: onboardingRule(['beat_id', 'resume_source'], p => typeof p.beat_id === 'string' && typeof p.resume_source === 'string'),
  onboarding_finished: onboardingRule(['outcome', 'destination', 'duration_ms', 'stitch_count'], p => isMember(p.outcome, new Set(['completed', 'deferred'])) && typeof p.destination === 'string' && isNonNegativeInteger(p.duration_ms) && isNonNegativeInteger(p.stitch_count)),
  account_soft_prompt_shown: onboardingRule(['context'], p => isMember(p.context, new Set(['welcome', 'tutorial', 'recap']))),
  account_soft_prompt_action: onboardingRule(['context', 'action'], p => isMember(p.context, new Set(['welcome', 'tutorial', 'recap'])) && isMember(p.action, new Set(['sign_in', 'dismissed']))),
};

export function validateGameplayEventPayload(
  kind: string,
  payload: unknown,
): { kind: GameplayEventKind; payload: GameplayEventPayload } {
  if (!isGameplayEventKind(kind)) {
    throw new BadRequestException('Unknown gameplay event kind');
  }
  if (!isRecord(payload)) {
    throw new BadRequestException('Gameplay event payload must be an object');
  }

  const rule = payloadRules[kind];
  const actualFields = Object.keys(payload);
  const hasUnknownField = actualFields.some(
    (field) => !rule.allowedFields.includes(field),
  );
  const hasMissingField = rule.allowedFields.some(
    (field) => !Object.hasOwn(payload, field),
  );
  if (hasUnknownField || hasMissingField || !rule.validate(payload)) {
    throw new BadRequestException(`Invalid payload for gameplay event kind ${kind}`);
  }

  return { kind, payload: payload as GameplayEventPayload };
}

export function isGameplayEventKind(value: string): value is GameplayEventKind {
  return (GAMEPLAY_EVENT_KINDS as readonly string[]).includes(value);
}

function sessionRule(): PayloadRule {
  return {
    allowedFields: ['session_id'],
    validate: (payload) =>
      typeof payload.session_id === 'string' && UUID_PATTERN.test(payload.session_id),
  };
}

function purchaseRule(): PayloadRule {
  return {
    allowedFields: ['product_kind', 'product_key'],
    validate: isPurchaseProduct,
  };
}

function isPurchaseProduct(payload: Record<string, unknown>): boolean {
  if (!isMember(payload.product_kind, PURCHASE_KINDS)) return false;
  return isMember(
    payload.product_key,
    PRODUCT_KEYS_BY_KIND[payload.product_kind as string] ?? new Set<string>(),
  );
}

function subscriptionChangeRule(): PayloadRule {
  return {
    allowedFields: ['source_plan', 'target_plan', 'platform'],
    validate: isSubscriptionChangeProduct,
  };
}

function isSubscriptionChangeProduct(payload: Record<string, unknown>): boolean {
  return (
    isMember(payload.source_plan, PREMIUM_PLAN_KEYS) &&
    isMember(payload.target_plan, PREMIUM_PLAN_KEYS) &&
    isMember(payload.platform, SUBSCRIPTION_CHANGE_PLATFORMS)
  );
}

function emptyPayloadRule(): PayloadRule {
  return {
    allowedFields: [],
    validate: () => true,
  };
}

function onboardingRule(fields: readonly string[], validate: (payload: Record<string, unknown>) => boolean): PayloadRule {
  return { allowedFields: ['onboarding_version', ...fields], validate: (payload) => typeof payload.onboarding_version === 'string' && payload.onboarding_version.length > 0 && payload.onboarding_version.length <= 32 && validate(payload) };
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isMember(value: unknown, values: ReadonlySet<string>): boolean {
  return typeof value === 'string' && values.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
