import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PostPublicationReviewStatus = 'open' | 'closed';
export type PostPublicationReviewCloseOutcome =
  | 'no_violation'
  | 'metadata_remediation';

@Entity({ name: 'post_publication_reviews', schema: 'moderation' })
@Index('IDX_post_publication_reviews_pattern', ['communityPatternId', 'createdAt'])
@Index('UQ_post_publication_reviews_open_pattern', ['communityPatternId'], {
  unique: true,
  where: '"status" = \'open\'',
})
@Check(
  'CHK_post_publication_reviews_status',
  '"status" IN (\'open\', \'closed\')',
)
@Check(
  'CHK_post_publication_reviews_closed_at',
  '("status" = \'open\' AND "closed_at" IS NULL) OR ("status" = \'closed\' AND "closed_at" IS NOT NULL)',
)
@Check(
  'CHK_post_publication_reviews_hold',
  '("hold_applied_at" IS NULL AND "hold_reason" IS NULL AND "hold_operator_account_id" IS NULL) OR ("hold_applied_at" IS NOT NULL AND length(btrim("hold_reason")) > 0 AND "hold_operator_account_id" IS NOT NULL)',
)
@Check(
  'CHK_post_publication_reviews_close_outcome',
  '"close_outcome" IN (\'no_violation\', \'metadata_remediation\')',
)
@Check(
  'CHK_post_publication_reviews_close',
  '("status" = \'open\' AND "close_outcome" IS NULL AND "close_reason" IS NULL AND "close_operator_account_id" IS NULL) OR ("status" = \'closed\' AND "close_outcome" IS NOT NULL AND length(btrim("close_reason")) > 0 AND "close_operator_account_id" IS NOT NULL)',
)
export class PostPublicationReviewEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_post_publication_reviews',
  })
  id!: string;

  @Column({ name: 'community_pattern_id', type: 'uuid' })
  communityPatternId!: string;

  @Column({ name: 'metadata_revision_id', nullable: true, type: 'uuid' })
  metadataRevisionId!: string | null;

  @Column({ default: 'open', length: 16, type: 'varchar' })
  status!: PostPublicationReviewStatus;

  @Column({ name: 'closed_at', nullable: true, type: 'timestamptz' })
  closedAt!: Date | null;

  @Column({ name: 'hold_applied_at', nullable: true, type: 'timestamptz' })
  holdAppliedAt!: Date | null;

  @Column({ length: 2000, name: 'hold_reason', nullable: true, type: 'varchar' })
  holdReason!: string | null;

  @Column({ name: 'hold_operator_account_id', nullable: true, type: 'uuid' })
  holdOperatorAccountId!: string | null;

  @Column({ name: 'close_outcome', nullable: true, type: 'varchar', length: 32 })
  closeOutcome!: PostPublicationReviewCloseOutcome | null;

  @Column({ length: 2000, name: 'close_reason', nullable: true, type: 'varchar' })
  closeReason!: string | null;

  @Column({ name: 'close_operator_account_id', nullable: true, type: 'uuid' })
  closeOperatorAccountId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
