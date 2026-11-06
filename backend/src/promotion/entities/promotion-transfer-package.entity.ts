import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

export const PROMOTION_MODES = ['economy', 'data-only'] as const;
export type PromotionMode = (typeof PROMOTION_MODES)[number];

export type PromotionPackageStatus = 'staged' | 'committed' | 'cancelled' | 'needs_attention';

/** A package in one of these states is committed: its Guest is consumed and its account has used the economy slot. */
export const CONSUMED_PACKAGE_STATUSES: readonly PromotionPackageStatus[] = ['committed', 'needs_attention'];

@Entity({ name: 'transfer_packages', schema: 'promotion' })
export class PromotionTransferPackageEntity {
  @PrimaryColumn('uuid', { name: 'guest_id' })
  guestId!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column({ name: 'manifest_checksum', length: 64 })
  manifestChecksum!: string;

  @Column('jsonb', { name: 'package_data' })
  packageData!: object;

  @Column({ length: 64 })
  checksum!: string;

  @Column('timestamptz')
  expiry!: Date;

  @Column({ length: 16, default: 'staged' })
  status!: PromotionPackageStatus;

  /** Set by commit from the verified preview; null until committed (and on legacy rows). */
  @Column('varchar', { name: 'promotion_mode', length: 16, nullable: true })
  promotionMode!: PromotionMode | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
