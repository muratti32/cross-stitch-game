import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { JsonObject } from '../../jobs/jobs.types';

export type OperatorAuditOutcome = 'success' | 'failure';

// Append-only (enforced by a database trigger — see migration
// CreateAdminAuditSchema). Written in the same transaction as the domain
// mutation it records.
@Entity({ name: 'operator_audit_log', schema: 'admin' })
@Index('IDX_operator_audit_log_account_created', [
  'operatorAccountId',
  'createdAt',
])
@Index('IDX_operator_audit_log_target', ['targetType', 'targetId'])
@Check('CHK_operator_audit_log_outcome', '"outcome" IN (\'success\', \'failure\')')
export class OperatorAuditLogEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_operator_audit_log',
  })
  id!: string;

  @Column({ name: 'operator_account_id', type: 'uuid' })
  operatorAccountId!: string;

  @Column({ type: 'varchar', length: 128 })
  action!: string;

  @Column({ name: 'target_type', type: 'varchar', length: 64 })
  targetType!: string;

  @Column({ name: 'target_id', nullable: true, type: 'varchar', length: 128 })
  targetId!: string | null;

  @Column({ nullable: true, type: 'jsonb' })
  before!: JsonObject | null;

  @Column({ nullable: true, type: 'jsonb' })
  after!: JsonObject | null;

  @Column({ name: 'request_id', nullable: true, type: 'varchar', length: 128 })
  requestId!: string | null;

  @Column({ type: 'varchar', length: 16 })
  outcome!: OperatorAuditOutcome;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
