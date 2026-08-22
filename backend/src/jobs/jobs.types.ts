import { ProcessingJobStatus } from './entities/processing-job-status.enum';

export type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface DemoJobPayload extends JsonObject {
  message: string;
}

export interface DemoJobResult extends JsonObject {
  echo: string;
  uppercase: string;
}

export interface DemoJobQueueData {
  processingJobId: string;
}

export type ProcessingJobEventName =
  | typeof import('./jobs.constants').DEMO_JOB_EVENT_NAME
  | typeof import('./jobs.constants').CONVERSION_JOB_EVENT_NAME
  | typeof import('./jobs.constants').OFFICIAL_PATTERN_DRAFT_EVENT_NAME
  | typeof import('./jobs.constants').AI_ARTWORK_JOB_EVENT_NAME
  | typeof import('./jobs.constants').CATALOG_PRECHECK_EVENT_NAME
  | typeof import('./jobs.constants').COMMERCE_PROMOTION_JOB_EVENT_NAME;

export type DemoJobQueueOutcome =
  | 'completed'
  | 'resumed-and-completed'
  | 'terminal-replay';

export interface DemoJobQueueResult {
  outcome: DemoJobQueueOutcome;
  processingJobId: string;
}

export interface ProcessingJobQueueResult {
  outcome: DemoJobQueueOutcome;
  processingJobId: string;
}

export interface CreatedDemoJob {
  id: string;
}

export interface DemoJobView {
  id: string;
  type: string;
  status: ProcessingJobStatus;
  payload: JsonObject;
  result: JsonObject | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
