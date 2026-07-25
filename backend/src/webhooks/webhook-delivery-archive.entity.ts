import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import type { JsonObject } from '../jobs/jobs.types';

export type WebhookProvider = 'revenuecat' | 'admob' | 'fal';
export type WebhookVerificationResult = 'verified' | 'failed';
export type WebhookProcessingOutcome =
  | 'processed'
  | 'duplicate_ignored'
  | 'verification_failed'
  | 'failed';

@Entity({ name: 'webhook_delivery_archives', schema: 'observability' })
@Index('IDX_webhook_delivery_archives_received_at', ['receivedAt'])
@Index('IDX_webhook_delivery_archives_provider_outcome_received', [
  'provider',
  'processingOutcome',
  'receivedAt',
])
@Check(
  'CHK_webhook_delivery_archives_provider',
  "provider IN ('revenuecat', 'admob', 'fal')",
)
@Check(
  'CHK_webhook_delivery_archives_verification',
  "verification_result IN ('verified', 'failed')",
)
@Check(
  'CHK_webhook_delivery_archives_outcome',
  "processing_outcome IN ('processed', 'duplicate_ignored', 'verification_failed', 'failed')",
)
export class WebhookDeliveryArchiveEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_webhook_delivery_archives',
  })
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  provider!: WebhookProvider;

  @Column({ name: 'provider_delivery_id', nullable: true, type: 'varchar', length: 256 })
  providerDeliveryId!: string | null;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ name: 'verification_result', type: 'varchar', length: 16 })
  verificationResult!: WebhookVerificationResult;

  @Column({ name: 'processing_outcome', type: 'varchar', length: 32 })
  processingOutcome!: WebhookProcessingOutcome;

  @Column({ name: 'failure_reason', nullable: true, type: 'varchar', length: 512 })
  failureReason!: string | null;

  @Column({ type: 'jsonb' })
  payload!: JsonObject;

  // Replays update their original delivery instead of producing a second raw
  // archive copy. The original archive id is the replay target/link.
  @Column({ name: 'replay_count', default: 0, type: 'integer' })
  replayCount!: number;

  @Column({ name: 'last_replayed_at', nullable: true, type: 'timestamptz' })
  lastReplayedAt!: Date | null;

  @Column({ name: 'last_replay_outcome', nullable: true, type: 'varchar', length: 32 })
  lastReplayOutcome!: WebhookProcessingOutcome | null;

  @Column({ name: 'last_replay_failure_reason', nullable: true, type: 'varchar', length: 512 })
  lastReplayFailureReason!: string | null;

  @Column({ name: 'last_replayed_by_operator_id', nullable: true, type: 'uuid' })
  lastReplayedByOperatorId!: string | null;
}
