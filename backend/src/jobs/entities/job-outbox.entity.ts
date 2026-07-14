import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { JsonObject } from '../jobs.types';
import { ProcessingJobEntity } from './processing-job.entity';

@Entity({ name: 'job_outbox', schema: 'jobs' })
@Index('IDX_job_outbox_undispatched', ['createdAt', 'id'], {
  where: '"dispatched_at" IS NULL',
})
@Index(
  'IDX_job_outbox_reconciliation',
  ['lastReconciledAt', 'createdAt', 'id'],
  { where: '"dispatched_at" IS NOT NULL' },
)
@Unique('UQ_job_outbox_processing_job_id', ['processingJobId'])
export class JobOutboxEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_job_outbox',
  })
  id!: string;

  @Column({ name: 'processing_job_id', type: 'uuid' })
  processingJobId!: string;

  @ManyToOne(() => ProcessingJobEntity, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_job_outbox_processing_job',
    name: 'processing_job_id',
  })
  processingJob!: ProcessingJobEntity;

  @Column({ length: 128, name: 'queue_name', type: 'varchar' })
  queueName!: string;

  @Column({ length: 128, name: 'event_name', type: 'varchar' })
  eventName!: string;

  @Column({ type: 'jsonb' })
  payload!: JsonObject;

  @Column({ name: 'dispatched_at', nullable: true, type: 'timestamptz' })
  dispatchedAt!: Date | null;

  @Column({
    name: 'last_reconciled_at',
    nullable: true,
    type: 'timestamptz',
  })
  lastReconciledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
