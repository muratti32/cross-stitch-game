import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export const COMMUNITY_REPORT_REASONS = [
  'inappropriate_or_unsafe_content',
  'copyright_or_publication_rights',
  'duplicate_or_spam',
  'misleading_title_or_tags',
  'other',
] as const;

export type CommunityReportReason = (typeof COMMUNITY_REPORT_REASONS)[number];

@Entity({ name: 'community_reports', schema: 'moderation' })
@Unique('UQ_community_reports_review_reporter', ['reviewId', 'reporterAccountId'])
@Index('IDX_community_reports_reporter_created', ['reporterAccountId', 'createdAt'])
@Check(
  'CHK_community_reports_reason',
  '"reason" IN (\'inappropriate_or_unsafe_content\', \'copyright_or_publication_rights\', \'duplicate_or_spam\', \'misleading_title_or_tags\', \'other\')',
)
@Check(
  'CHK_community_reports_other_explanation',
  '"reason" <> \'other\' OR ("explanation" IS NOT NULL AND length(btrim("explanation")) > 0)',
)
@Check(
  'CHK_community_reports_evidence_digest',
  '("explanation" IS NULL AND "evidence_digest" IS NULL) OR ("explanation" IS NOT NULL AND "evidence_digest" IS NOT NULL)',
)
export class CommunityReportEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_community_reports',
  })
  id!: string;

  @Column({ name: 'review_id', type: 'uuid' })
  reviewId!: string;

  @Column({ name: 'reporter_account_id', type: 'uuid' })
  reporterAccountId!: string;

  @Column({ length: 64, type: 'varchar' })
  reason!: CommunityReportReason;

  @Column({ length: 2000, nullable: true, type: 'varchar' })
  explanation!: string | null;

  @Column({ length: 64, name: 'evidence_digest', nullable: true, type: 'char' })
  evidenceDigest!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
