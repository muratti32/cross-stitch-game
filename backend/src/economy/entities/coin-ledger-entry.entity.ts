import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { CoinLedgerReason } from './coin-ledger-reason.enum';

@Entity({ name: 'coin_ledger_entries', schema: 'economy' })
@Unique('UQ_coin_ledger_entries_source_key', ['sourceKey'])
@Index('IDX_coin_ledger_entries_principal', [
  'principalType',
  'principalId',
  'createdAt',
])
@Check(
  'CHK_coin_ledger_entries_principal_type',
  '"principal_type" IN (\'guest\', \'account\')',
)
@Check('CHK_coin_ledger_entries_reason', '"reason" IN (\'ad_reward\', \'first_completion\', \'unlock_spend\', \'daily_task\', \'guest_promotion\', \'coin_pack_purchase\', \'commerce_reversal\', \'premium_daily_claim\', \'commerce_transfer\')')
export class CoinLedgerEntryEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_coin_ledger_entries',
  })
  id!: string;

  @Column({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: string;

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  // bigint returned as string by the driver; signed so reversals fit later.
  @Column({ type: 'bigint' })
  amount!: string;

  @Column({ type: 'varchar', length: 32 })
  reason!: CoinLedgerReason;

  @Column({ name: 'source_key', type: 'varchar', length: 255 })
  sourceKey!: string;

  @Column({ type: 'boolean' })
  granted!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
