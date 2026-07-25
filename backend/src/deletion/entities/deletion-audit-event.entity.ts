import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'deletion_audit_events', schema: 'deletion' })
export class DeletionAuditEventEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_deletion_audit_events',
  })
  id!: string;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @Column({ length: 48, type: 'varchar' })
  event!: string;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ default: '{}', type: 'jsonb' })
  details!: Record<string, unknown>;
}
