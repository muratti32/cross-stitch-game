import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'provider_job_tombstones', schema: 'deletion' })
@Index('UQ_provider_job_tombstones_provider_request', ['provider', 'providerRequestId'], {
  unique: true,
})
@Index('IDX_provider_job_tombstones_processing_job_id', ['processingJobId'])
export class ProviderJobTombstoneEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_provider_job_tombstones',
  })
  id!: string;

  @Column({ length: 32, type: 'varchar' })
  provider!: string;

  @Column({ name: 'provider_request_id', length: 128, type: 'varchar' })
  providerRequestId!: string;

  @Column({ name: 'processing_job_id', type: 'uuid' })
  processingJobId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
