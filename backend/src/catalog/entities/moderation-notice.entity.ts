import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type ModerationNoticeType =
  | 'review_hold'
  | 'no_violation'
  | 'metadata_remediation';

@Entity({ name: 'moderation_notices', schema: 'moderation' })
@Unique('UQ_moderation_notices_review_type', ['reviewId', 'noticeType'])
@Index('IDX_moderation_notices_account_created', ['accountId', 'createdAt'])
@Check(
  'CHK_moderation_notices_type',
  '"notice_type" IN (\'review_hold\', \'no_violation\', \'metadata_remediation\')',
)
export class ModerationNoticeEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_moderation_notices',
  })
  id!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ name: 'community_pattern_id', type: 'uuid' })
  communityPatternId!: string;

  @Column({ name: 'review_id', type: 'uuid' })
  reviewId!: string;

  @Column({ length: 32, name: 'notice_type', type: 'varchar' })
  noticeType!: ModerationNoticeType;

  @Column({ length: 255, name: 'pattern_title', type: 'varchar' })
  patternTitle!: string;

  @Column({ length: 2000, type: 'varchar' })
  reason!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
