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
  'purchase_started',
  'purchase_completed',
  'purchase_cancelled',
  'purchase_failed',
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
};
type PurchaseFailedPayload = PurchasePayload & {
  failure_stage: 'store' | 'verification' | 'grant';
};

export type GameplayEventPayload =
  | SessionPayload
  | DailyTaskPayload
  | PatternConversionStartedPayload
  | PatternConversionCompletedPayload
  | PatternConversionFailedPayload
  | AiGenerationStartedPayload
  | AiGenerationFailedPayload
  | PurchasePayload
  | PurchaseFailedPayload
  | Record<string, never>;

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
const PURCHASE_FAILURE_STAGES = new Set(['store', 'verification', 'grant']);

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
  purchase_started: purchaseRule(),
  purchase_completed: purchaseRule(),
  purchase_cancelled: purchaseRule(),
  purchase_failed: {
    allowedFields: ['product_kind', 'failure_stage'],
    validate: (payload) =>
      isMember(payload.product_kind, PURCHASE_KINDS) &&
      isMember(payload.failure_stage, PURCHASE_FAILURE_STAGES),
  },
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
    allowedFields: ['product_kind'],
    validate: (payload) => isMember(payload.product_kind, PURCHASE_KINDS),
  };
}

function emptyPayloadRule(): PayloadRule {
  return {
    allowedFields: [],
    validate: () => true,
  };
}

function isMember(value: unknown, values: ReadonlySet<string>): boolean {
  return typeof value === 'string' && values.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
