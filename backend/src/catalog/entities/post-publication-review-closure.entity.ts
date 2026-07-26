import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type PostPublicationReviewClosureRecordType =
  | 'metadata_appeal'
  | 'metadata_revision';

@Entity({ name: 'post_publication_review_closures', schema: 'moderation' })
@Unique('UQ_post_publication_review_closures_record', [
  'reviewId',
  'recordType',
  'recordId',
])
@Index('IDX_post_publication_review_closures_review', ['reviewId', 'createdAt'])
@Check(
  'CHK_post_publication_review_closures_record_type',
  '"record_type" IN (\'metadata_revision\', \'metadata_appeal\')',
)
export class PostPublicationReviewClosureEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_post_publication_review_closures',
  })
  id!: string;

  @Column({ name: 'review_id', type: 'uuid' })
  reviewId!: string;

  @Column({ length: 32, name: 'record_type', type: 'varchar' })
  recordType!: PostPublicationReviewClosureRecordType;

  @Column({ name: 'record_id', type: 'uuid' })
  recordId!: string;

  @Column({ length: 32, name: 'from_status', type: 'varchar' })
  fromStatus!: string;

  @Column({ length: 32, name: 'to_status', type: 'varchar' })
  toStatus!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
