import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { JsonObject } from '../../jobs/jobs.types';

export type OperatorSecurityEventType =
  | 'sign_in_failed'
  | 'mfa_bypassed'
  | 'mfa_succeeded'
  | 'mfa_failed'
  | 'refresh_reuse_detected'
  | 'authorization_denied';

// Append-only (enforced by a database trigger). Always committed on its own,
// independent transaction so a rolled-back domain mutation can never erase a
// security event (see OperatorSecurityEventsService).
@Entity({ name: 'operator_security_events', schema: 'admin' })
@Index('IDX_operator_security_events_account_created', [
  'operatorAccountId',
  'createdAt',
])
@Index('IDX_operator_security_events_type_created', ['eventType', 'createdAt'])
export class OperatorSecurityEventEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_operator_security_events',
  })
  id!: string;

  @Column({ name: 'operator_account_id', nullable: true, type: 'uuid' })
  operatorAccountId!: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType!: OperatorSecurityEventType;

  @Column({ nullable: true, type: 'jsonb' })
  detail!: JsonObject | null;

  @Column({ nullable: true, type: 'varchar', length: 64 })
  ip!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
