import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'operational_alert_runs', schema: 'observability' })
@Index('IDX_operational_alert_runs_evaluated_at', ['evaluatedAt'])
export class OperationalAlertRunEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_operational_alert_runs',
  })
  id!: string;

  @CreateDateColumn({ name: 'evaluated_at', type: 'timestamptz' })
  evaluatedAt!: Date;

  @Column({ name: 'queue_depth_value', type: 'integer' })
  queueDepthValue!: number;

  @Column({ name: 'queue_depth_threshold', type: 'integer' })
  queueDepthThreshold!: number;

  @Column({ name: 'queue_depth_breached', type: 'boolean' })
  queueDepthBreached!: boolean;

  @Column({ name: 'webhook_failures_value', type: 'integer' })
  webhookFailuresValue!: number;

  @Column({ name: 'webhook_failures_threshold', type: 'integer' })
  webhookFailuresThreshold!: number;

  @Column({ name: 'webhook_failures_breached', type: 'boolean' })
  webhookFailuresBreached!: boolean;

  @Column({ name: 'stuck_jobs_value', type: 'integer' })
  stuckJobsValue!: number;

  @Column({ name: 'stuck_jobs_threshold', type: 'integer' })
  stuckJobsThreshold!: number;

  @Column({ name: 'stuck_jobs_breached', type: 'boolean' })
  stuckJobsBreached!: boolean;

  @Column({ name: 'promotion_needs_attention_value', type: 'integer' })
  promotionNeedsAttentionValue!: number;

  @Column({ name: 'promotion_needs_attention_threshold', type: 'integer' })
  promotionNeedsAttentionThreshold!: number;

  @Column({ name: 'promotion_needs_attention_breached', type: 'boolean' })
  promotionNeedsAttentionBreached!: boolean;
}
