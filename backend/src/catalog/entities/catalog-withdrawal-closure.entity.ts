import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type CatalogWithdrawalClosureRecordType =
  | 'metadata_appeal'
  | 'metadata_revision';

@Entity({ name: 'catalog_withdrawal_closures', schema: 'catalog' })
@Unique('UQ_catalog_withdrawal_closures_record', [
  'withdrawalId',
  'recordType',
  'recordId',
])
@Index('IDX_catalog_withdrawal_closures_withdrawal', ['withdrawalId', 'createdAt'])
@Check(
  'CHK_catalog_withdrawal_closures_record_type',
  '"record_type" IN (\'metadata_revision\', \'metadata_appeal\')',
)
export class CatalogWithdrawalClosureEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_catalog_withdrawal_closures',
  })
  id!: string;

  @Column({ name: 'withdrawal_id', type: 'uuid' })
  withdrawalId!: string;

  @Column({ length: 32, name: 'record_type', type: 'varchar' })
  recordType!: CatalogWithdrawalClosureRecordType;

  @Column({ name: 'record_id', type: 'uuid' })
  recordId!: string;

  @Column({ length: 32, name: 'from_status', type: 'varchar' })
  fromStatus!: string;

  @Column({ length: 32, name: 'to_status', type: 'varchar' })
  toStatus!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
