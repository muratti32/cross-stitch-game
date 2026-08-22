export const DEMO_JOB_TYPE = 'demo' as const;
export const DEMO_JOBS_QUEUE_NAME = 'processing-jobs' as const;
export const DEMO_JOB_EVENT_NAME = 'demo-job.requested' as const;
export const CONVERSION_JOB_TYPE = 'pattern-conversion' as const;
export const CONVERSION_JOB_EVENT_NAME = 'pattern-conversion.requested' as const;
export const OFFICIAL_PATTERN_DRAFT_JOB_TYPE = 'official-pattern-draft' as const;
export const OFFICIAL_PATTERN_DRAFT_EVENT_NAME =
  'official-pattern-draft.requested' as const;
export const AI_ARTWORK_JOB_TYPE = 'ai-artwork-generation' as const;
export const AI_ARTWORK_JOB_EVENT_NAME = 'ai-artwork-generation.requested' as const;
export const CATALOG_PRECHECK_JOB_TYPE = 'catalog-precheck' as const;
export const CATALOG_PRECHECK_EVENT_NAME = 'catalog-precheck.requested' as const;
export const COMMERCE_PROMOTION_JOB_TYPE = 'commerce-promotion' as const;
export const COMMERCE_PROMOTION_JOB_EVENT_NAME = 'commerce-promotion.requested' as const;

export const DEFAULT_OUTBOX_BATCH_SIZE = 25;
export const DEFAULT_OUTBOX_POLL_INTERVAL_MS = 500;
export const OUTBOX_RETRY_INTERVAL_MS = 1_000;
