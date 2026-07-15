import { Check, Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

export type ProgressDesiredState = 'completed' | 'incomplete';

@Entity({ name: 'progress_operations', schema: 'sessions' })
@Unique('UQ_progress_operations_device_seq', ['sessionId', 'deviceId', 'deviceSeq'])
@Index('IDX_progress_operations_pull', ['sessionId', 'serverRevision'])
@Check('CHK_progress_operations_desired_state', '"desired_state" IN (\'completed\', \'incomplete\')')
export class ProgressOperationEntity {
  @PrimaryColumn({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @PrimaryColumn({ name: 'op_id', type: 'uuid' })
  opId!: string;

  @Column({ name: 'device_id', type: 'uuid' })
  deviceId!: string;

  @Column({ name: 'device_seq', type: 'bigint' })
  deviceSeq!: string;

  @Column({ name: 'cell_index', type: 'integer' })
  cellIndex!: number;

  @Column({ name: 'desired_state', type: 'varchar', length: 16 })
  desiredState!: ProgressDesiredState;

  @Column({ name: 'base_revision', type: 'bigint' })
  baseRevision!: string;

  @Column({ name: 'server_revision', type: 'bigint' })
  serverRevision!: string;

  @Column({ type: 'boolean' })
  effective!: boolean;

  @Column({ type: 'boolean', default: false })
  superseded!: boolean;

  // The authoritative cell state the merge decided for this op (nextState).
  // Null for superseded operations, which never change cell state.
  @Column({ name: 'resolved_state', type: 'varchar', length: 16, nullable: true })
  resolvedState!: ProgressDesiredState | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
