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

export type DemoJobQueueOutcome =
  | 'completed'
  | 'resumed-and-completed'
  | 'terminal-replay';

export interface DemoJobQueueResult {
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

