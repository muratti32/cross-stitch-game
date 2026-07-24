import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ProfileReportReasonCode =
  | 'impersonation'
  | 'offensive'
  | 'spam'
  | 'other';

@Entity({ name: 'profile_reports', schema: 'moderation' })
@Index(
  'UQ_profile_reports_reporter_investigation',
  ['investigationId', 'reporterAccountId'],
  { unique: true },
)
@Index('IDX_profile_reports_investigation', ['investigationId', 'createdAt'])
@Check(
  'CHK_profile_reports_reason_code',
  '"reason_code" IN (\'impersonation\', \'offensive\', \'spam\', \'other\')',
)
export class ProfileReportEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_profile_reports',
  })
  id!: string;

  @Column({ name: 'investigation_id', type: 'uuid' })
  investigationId!: string;

  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @Column({ name: 'reporter_account_id', type: 'uuid' })
  reporterAccountId!: string;

  @Column({ length: 32, name: 'reason_code', type: 'varchar' })
  reasonCode!: ProfileReportReasonCode;

  @Column({ length: 1000, nullable: true, type: 'varchar' })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
