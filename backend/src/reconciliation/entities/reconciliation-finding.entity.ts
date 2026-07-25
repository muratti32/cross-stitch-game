import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ReconciliationFindingClass =
  | 'commerce_delivery_without_ledger'
  | 'commerce_ledger_without_delivery'
  | 'storage_registry_missing_object'
  | 'storage_orphan_object'
  | 'ai_credit_reservation_stuck';

@Entity({ name: 'reconciliation_findings', schema: 'observability' })
@Index('IDX_reconciliation_findings_run_class', ['runId', 'findingClass'])
@Check(
  'CHK_reconciliation_findings_class',
  "finding_class IN ('commerce_delivery_without_ledger', 'commerce_ledger_without_delivery', 'storage_registry_missing_object', 'storage_orphan_object', 'ai_credit_reservation_stuck')",
)
export class ReconciliationFindingEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_reconciliation_findings',
  })
  id!: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;

  @Column({ name: 'finding_class', type: 'varchar', length: 64 })
  findingClass!: ReconciliationFindingClass;

  @Column({ type: 'varchar', length: 512 })
  identifier!: string;

  @Column({ name: 'related_identifier', nullable: true, type: 'varchar', length: 512 })
  relatedIdentifier!: string | null;

  @Column({ nullable: true, type: 'varchar', length: 64 })
  detail!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
