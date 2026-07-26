import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export type SafetyRemovalAppealStatus = 'open' | 'accepted' | 'rejected';

@Entity({ name: 'safety_removal_appeals', schema: 'moderation' })
@Unique('UQ_safety_removal_appeals_review', ['reviewId'])
@Index('IDX_safety_removal_appeals_pattern', ['communityPatternId', 'createdAt'])
@Check(
  'CHK_safety_removal_appeals_status',
  '"status" IN (\'open\', \'accepted\', \'rejected\')',
)
@Check(
  'CHK_safety_removal_appeals_decision',
  '("status" = \'open\' AND "decided_at" IS NULL AND "decision_operator_account_id" IS NULL AND "decision_reason" IS NULL AND "same_moderator_fallback" = false) OR ("status" IN (\'accepted\', \'rejected\') AND "decided_at" IS NOT NULL AND "decision_operator_account_id" IS NOT NULL AND length(btrim("decision_reason")) > 0)',
)
export class SafetyRemovalAppealEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_safety_removal_appeals',
  })
  id!: string;

  @Column({ name: 'review_id', type: 'uuid' })
  reviewId!: string;

  @Column({ name: 'community_pattern_id', type: 'uuid' })
  communityPatternId!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ length: 1000, nullable: true, type: 'varchar' })
  note!: string | null;

  @Column({ default: 'open', length: 16, type: 'varchar' })
  status!: SafetyRemovalAppealStatus;

  // The moderator who applied Safety Removal, recorded at appeal creation so
  // review can be assigned to a different moderator when one exists.
  @Column({ name: 'excluded_operator_account_id', type: 'uuid' })
  excludedOperatorAccountId!: string;

  @Column({ name: 'decided_at', nullable: true, type: 'timestamptz' })
  decidedAt!: Date | null;

  @Column({ name: 'decision_operator_account_id', nullable: true, type: 'uuid' })
  decisionOperatorAccountId!: string | null;

  @Column({ length: 2000, name: 'decision_reason', nullable: true, type: 'varchar' })
  decisionReason!: string | null;

  // Audits the case where no other eligible moderator existed and the
  // excluded moderator resolved their own Safety Removal decision.
  @Column({ default: false, name: 'same_moderator_fallback', type: 'boolean' })
  sameModeratorFallback!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
