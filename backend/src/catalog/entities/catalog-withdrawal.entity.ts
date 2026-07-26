import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'catalog_withdrawals', schema: 'catalog' })
@Index('UQ_catalog_withdrawals_pattern', ['communityPatternId'], { unique: true })
@Index('IDX_catalog_withdrawals_account_created', ['accountId', 'createdAt'])
export class CatalogWithdrawalEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_catalog_withdrawals',
  })
  id!: string;

  @Column({ name: 'community_pattern_id', type: 'uuid' })
  communityPatternId!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ name: 'creator_profile_id', type: 'uuid' })
  creatorProfileId!: string;

  @Column({ length: 16, name: 'previous_status', type: 'varchar' })
  previousStatus!: 'available';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
