import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { AiCreditLedgerReason } from './ai-credit-ledger-reason.enum';

@Entity({ name: 'ai_credit_ledger_entries', schema: 'economy' })
@Unique('UQ_ai_credit_ledger_entries_source_key', ['sourceKey'])
@Index('IDX_ai_credit_ledger_entries_principal', [
  'principalType',
  'principalId',
  'createdAt',
])
@Check(
  'CHK_ai_credit_ledger_entries_principal_type',
  '"principal_type" IN (\'guest\', \'account\')',
)
@Check(
  'CHK_ai_credit_ledger_entries_reason',
  '"reason" IN (\'pack_purchase\', \'commerce_reversal\', \'membership_credit_grant\', \'membership_reversal\')',
)
export class AiCreditLedgerEntryEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_ai_credit_ledger_entries',
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
  reason!: AiCreditLedgerReason;

  @Column({ name: 'source_key', type: 'varchar', length: 255 })
  sourceKey!: string;

  @Column({ type: 'boolean' })
  granted!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
