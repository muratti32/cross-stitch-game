import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { JsonObject } from '../jobs.types';
import { ProcessingJobStatus } from './processing-job-status.enum';

@Entity({ name: 'processing_jobs', schema: 'jobs' })
@Index('IDX_processing_jobs_status', ['status'])
@Check(
  'CHK_processing_jobs_status',
  '"status" IN (\'pending\', \'dispatched\', \'running\', \'completed\', \'failed\')',
)
export class ProcessingJobEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_processing_jobs',
  })
  id!: string;

  @Column({ length: 64, type: 'varchar' })
  type!: string;

  @Column({
    default: ProcessingJobStatus.Pending,
    length: 32,
    type: 'varchar',
  })
  status!: ProcessingJobStatus;

  @Column({ type: 'jsonb' })
  payload!: JsonObject;

  @Column({ nullable: true, type: 'jsonb' })
  result!: JsonObject | null;

  @Column({ name: 'error_message', nullable: true, type: 'text' })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
