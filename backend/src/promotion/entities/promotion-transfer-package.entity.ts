import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity({ name: 'transfer_packages', schema: 'promotion' })
export class PromotionTransferPackageEntity {
  @PrimaryColumn('uuid', { name: 'guest_id' })
  guestId!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column({ name: 'manifest_checksum', length: 64 })
  manifestChecksum!: string;

  @Column('jsonb', { name: 'package_data' })
  packageData!: any;

  @Column({ length: 64 })
  checksum!: string;

  @Column('timestamptz')
  expiry!: Date;

  @Column({ length: 16, default: 'staged' })
  status!: 'staged' | 'committed' | 'cancelled';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
