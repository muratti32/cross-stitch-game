import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ProfileInvestigationStatus = 'open' | 'closed';

@Entity({ name: 'profile_investigations', schema: 'moderation' })
@Index('IDX_profile_investigations_review_queue', ['status', 'openedAt'])
@Index('IDX_profile_investigations_profile', ['profileId', 'openedAt'])
@Check(
  'CHK_profile_investigations_status',
  '"status" IN (\'open\', \'closed\')',
)
export class ProfileInvestigationEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_profile_investigations',
  })
  id!: string;

  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @Column({ length: 16, type: 'varchar' })
  status!: ProfileInvestigationStatus;

  @Column({ name: 'profile_version_at_open', type: 'integer' })
  profileVersionAtOpen!: number;

  @Column({ name: 'report_count', type: 'integer' })
  reportCount!: number;

  @CreateDateColumn({ name: 'opened_at', type: 'timestamptz' })
  openedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'closed_at', nullable: true, type: 'timestamptz' })
  closedAt!: Date | null;

  @Column({ name: 'closed_by', nullable: true, type: 'uuid' })
  closedBy!: string | null;

  @Column({ length: 32, name: 'close_outcome', nullable: true, type: 'varchar' })
  closeOutcome!: string | null;
}
