export const DEMO_JOB_TYPE = 'demo' as const;
export const DEMO_JOBS_QUEUE_NAME = 'processing-jobs' as const;
export const DEMO_JOB_EVENT_NAME = 'demo-job.requested' as const;
export const CONVERSION_JOB_TYPE = 'pattern-conversion' as const;
export const CONVERSION_JOB_EVENT_NAME = 'pattern-conversion.requested' as const;

export const DEFAULT_OUTBOX_BATCH_SIZE = 25;
export const DEFAULT_OUTBOX_POLL_INTERVAL_MS = 500;
export const OUTBOX_RETRY_INTERVAL_MS = 1_000;
