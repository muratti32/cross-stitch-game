export type OperationalAlertSignal =
  | 'queue_depth'
  | 'webhook_failures'
  | 'stuck_jobs'
  | 'promotion_needs_attention';

export interface OperationalAlertSignalResult {
  signal: OperationalAlertSignal;
  value: number;
  threshold: number;
  breached: boolean;
}

export interface OperationalAlertsEvaluation {
  evaluatedAt: Date;
  queueDepth: OperationalAlertSignalResult;
  webhookFailures: OperationalAlertSignalResult;
  stuckJobs: OperationalAlertSignalResult;
  promotionNeedsAttention: OperationalAlertSignalResult;
}
