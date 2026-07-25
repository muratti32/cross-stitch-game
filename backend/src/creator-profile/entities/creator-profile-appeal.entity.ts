import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export type CreatorProfileAppealStatus = 'open' | 'accepted' | 'upheld' | 'dismissed';

// One Creator Restriction Appeal per restricting Profile Investigation
// (unique below): the restriction stays fully in effect until this
// resolves, and an upheld outcome is final because a second appeal can
// never be filed against the same investigation.
@Entity({ name: 'creator_profile_appeals', schema: 'moderation' })
@Unique('UQ_creator_profile_appeals_investigation', ['investigationId'])
@Index('IDX_creator_profile_appeals_profile', ['profileId', 'createdAt'])
@Check(
  'CHK_creator_profile_appeals_status',
  '"status" IN (\'open\', \'accepted\', \'upheld\', \'dismissed\')',
)
export class CreatorProfileAppealEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_creator_profile_appeals',
  })
  id!: string;

  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @Column({ name: 'investigation_id', type: 'uuid' })
  investigationId!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ name: 'restricting_operator_id', nullable: true, type: 'uuid' })
  restrictingOperatorId!: string | null;

  @Column({ name: 'assigned_operator_id', nullable: true, type: 'uuid' })
  assignedOperatorId!: string | null;

  @Column({ length: 16, type: 'varchar' })
  status!: CreatorProfileAppealStatus;

  @Column({ length: 1000, nullable: true, type: 'varchar' })
  note!: string | null;

  @Column({ name: 'decided_by', nullable: true, type: 'uuid' })
  decidedBy!: string | null;

  @Column({ name: 'decided_at', nullable: true, type: 'timestamptz' })
  decidedAt!: Date | null;

  @Column({ length: 64, nullable: true, type: 'varchar' })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
