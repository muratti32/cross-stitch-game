import { Check, Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type SupportRecordType =
  | 'ai_artwork'
  | 'ai_credit_pack_purchase_reconciliation'
  | 'coin_pack_purchase_reconciliation'
  | 'premium_purchase_reconciliation'
  | 'pattern_conversion'
  | 'processing_job';

@Entity({ name: 'support_reference_records', schema: 'support' })
@Unique('UQ_support_reference_records_reference_record', [
  'supportReferenceId',
  'recordType',
  'recordId',
])
@Index('IDX_support_reference_records_record', ['recordType', 'recordId'])
@Check(
  'CHK_support_reference_records_type',
  '"record_type" IN (\'ai_artwork\', \'ai_credit_pack_purchase_reconciliation\', \'coin_pack_purchase_reconciliation\', \'premium_purchase_reconciliation\', \'pattern_conversion\', \'processing_job\')',
)
export class SupportReferenceRecordEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_support_reference_records',
  })
  id!: string;

  @Column({ name: 'support_reference_id', type: 'uuid' })
  supportReferenceId!: string;

  @Column({ name: 'record_type', type: 'varchar', length: 64 })
  recordType!: SupportRecordType;

  @Column({ name: 'record_id', type: 'uuid' })
  recordId!: string;
}
