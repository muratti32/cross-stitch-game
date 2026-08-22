import { Column, CreateDateColumn, Entity, PrimaryColumn, Unique } from 'typeorm';

@Entity({ name: 'personal_patterns', schema: 'conversion' })
@Unique('UQ_personal_patterns_processing_job_id', ['processingJobId'])
export class PersonalPatternEntity {
  @PrimaryColumn({ name: 'pattern_id', type: 'uuid' })
  patternId!: string;

  @Column({ name: 'owner_account_id', type: 'uuid', nullable: true })
  ownerAccountId!: string | null;

  @Column({ name: 'guest_installation_id', type: 'uuid', nullable: true })
  guestInstallationId!: string | null;

  @Column({ name: 'processing_job_id', type: 'uuid', nullable: true })
  processingJobId!: string | null;

  @Column({ name: 'derived_from_pattern_id', type: 'uuid', nullable: true })
  derivedFromPatternId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
