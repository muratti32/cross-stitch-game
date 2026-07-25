import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'reconciliation_runs', schema: 'observability' })
@Index('IDX_reconciliation_runs_ran_at', ['ranAt'])
export class ReconciliationRunEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_reconciliation_runs',
  })
  id!: string;

  @CreateDateColumn({ name: 'ran_at', type: 'timestamptz' })
  ranAt!: Date;

  @Column({ name: 'commerce_window_start', type: 'timestamptz' })
  commerceWindowStart!: Date;

  @Column({ name: 'commerce_delivery_without_ledger_count', type: 'integer' })
  commerceDeliveryWithoutLedgerCount!: number;

  @Column({ name: 'commerce_ledger_without_delivery_count', type: 'integer' })
  commerceLedgerWithoutDeliveryCount!: number;

  @Column({ name: 'storage_registry_missing_object_count', type: 'integer' })
  storageRegistryMissingObjectCount!: number;

  @Column({ name: 'storage_orphan_object_count', type: 'integer' })
  storageOrphanObjectCount!: number;

  @Column({ name: 'ai_credit_reservation_stuck_count', type: 'integer' })
  aiCreditReservationStuckCount!: number;
}
