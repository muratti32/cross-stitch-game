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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
