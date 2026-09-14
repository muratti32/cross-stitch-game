import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'locator_attempts', schema: 'economy' })
@Index('IDX_locator_attempts_principal_session', ['principalType', 'principalId', 'sessionId'])
@Check(
  'CHK_locator_attempts_principal_type',
  '"principal_type" IN (\'guest\', \'account\')',
)
@Check('CHK_locator_attempts_reserved_price', '"reserved_price" BETWEEN 1 AND 10')
@Check(
  'CHK_locator_attempts_status',
  '"status" IN (\'prepared\', \'committed\', \'released\', \'expired\', \'rejected\')',
)
export class LocatorAttemptEntity {
  @PrimaryColumn({ name: 'attempt_id', type: 'uuid' })
  attemptId!: string;

  @Column({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: string;

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @Column({ name: 'pattern_id', type: 'uuid' })
  patternId!: string;

  @Column({ name: 'color_index', type: 'integer' })
  colorIndex!: number;

  @Column({ name: 'dmc_code', type: 'varchar', length: 16 })
  dmcCode!: string;

  @Column({ name: 'target_cell_index', type: 'integer', nullable: true })
  targetCellIndex!: number | null;

  @Column({ name: 'progress_revision', type: 'bigint', nullable: true })
  progressRevision!: string | null;

  @Column({ name: 'progress_hash', type: 'varchar', length: 128, nullable: true })
  progressHash!: string | null;

  @Column({ name: 'reserved_price', type: 'integer' })
  reservedPrice!: number;

  @Column({ name: 'reserved_paid_amount', type: 'bigint', default: 0 })
  reservedPaidAmount!: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'prepared' })
  status!: 'prepared' | 'committed' | 'released' | 'expired' | 'rejected';

  @Column({ name: 'reserved_until', type: 'timestamptz' })
  reservedUntil!: Date;

  @Column({ name: 'terminal_at', type: 'timestamptz', nullable: true })
  terminalAt!: Date | null;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
