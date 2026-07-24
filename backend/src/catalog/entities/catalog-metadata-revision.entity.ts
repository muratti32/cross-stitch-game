import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { CatalogRejectionReason } from './catalog-submission.entity';

export type CatalogMetadataRevisionStatus =
  | 'pending'
  | 'rejected'
  | 'appeal_pending'
  | 'appeal_upheld'
  | 'accepted'
  | 'withdrawn';

@Entity({ name: 'catalog_metadata_revisions', schema: 'catalog' })
@Index('IDX_catalog_metadata_revisions_account', ['accountId', 'createdAt'])
@Index('IDX_catalog_metadata_revisions_review_queue', ['status', 'createdAt'])
@Index('IDX_catalog_metadata_revisions_pattern', ['communityPatternId', 'createdAt'])
@Check(
  'CHK_catalog_metadata_revisions_status',
  '"status" IN (\'pending\', \'rejected\', \'appeal_pending\', \'appeal_upheld\', \'accepted\', \'withdrawn\')',
)
export class CatalogMetadataRevisionEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_catalog_metadata_revisions' })
  id!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ name: 'creator_profile_id', type: 'uuid' })
  creatorProfileId!: string;

  @Column({ name: 'community_pattern_id', type: 'uuid' })
  communityPatternId!: string;

  @Column({ length: 120, type: 'varchar' })
  title!: string;

  @Column({ length: 2000, type: 'varchar' })
  description!: string;

  @Column({ length: 16, name: 'source_language', type: 'varchar' })
  sourceLanguage!: string;

  @Column({ length: 64, name: 'category_code', type: 'varchar' })
  categoryCode!: string;

  @Column({ array: true, name: 'tag_codes', type: 'text' })
  tagCodes!: string[];

  @Column({ name: 'metadata_valid', nullable: true, type: 'boolean' })
  metadataValid!: boolean | null;

  @Column({ name: 'metadata_errors', nullable: true, type: 'jsonb' })
  metadataErrors!: string[] | null;

  @Column({ name: 'moderation_evidence', nullable: true, type: 'jsonb' })
  moderationEvidence!: Record<string, unknown> | null;

  @Column({ length: 32, type: 'varchar', default: 'pending' })
  status!: CatalogMetadataRevisionStatus;

  @Column({ length: 32, name: 'rejection_reason', nullable: true, type: 'varchar' })
  rejectionReason!: CatalogRejectionReason | null;

  @Column({ name: 'rejection_note', nullable: true, type: 'text' })
  rejectionNote!: string | null;

  @Column({ name: 'initial_moderator_id', nullable: true, type: 'uuid' })
  initialModeratorId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
