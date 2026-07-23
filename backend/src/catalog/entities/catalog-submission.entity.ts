import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CatalogSubmissionStatus =
  | 'precheck_pending'
  | 'review_pending'
  | 'quarantined'
  | 'precheck_failed'
  | 'rejected'
  | 'appeal_pending'
  | 'appeal_upheld'
  | 'accepted';

export type CatalogRejectionReason =
  | 'safety'
  | 'publication_rights'
  | 'duplicate_or_spam'
  | 'technical_invalidity'
  | 'quality_standard';

@Entity({ name: 'catalog_submissions', schema: 'catalog' })
@Index('IDX_catalog_submissions_account', ['accountId', 'createdAt'])
@Index('IDX_catalog_submissions_review_queue', ['status', 'createdAt'])
@Check(
  'CHK_catalog_submissions_status',
  '"status" IN (\'precheck_pending\', \'review_pending\', \'quarantined\', \'precheck_failed\', \'rejected\', \'appeal_pending\', \'appeal_upheld\', \'accepted\')',
)
export class CatalogSubmissionEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_catalog_submissions' })
  id!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ name: 'creator_profile_id', type: 'uuid' })
  creatorProfileId!: string;

  @Column({ name: 'source_pattern_id', type: 'uuid' })
  sourcePatternId!: string;

  @Column({ name: 'processing_job_id', type: 'uuid', unique: true })
  processingJobId!: string;

  @Column({ length: 120, type: 'varchar' })
  title!: string;

  @Column({ length: 2000, type: 'varchar' })
  description!: string;

  @Column({ length: 16, name: 'source_language', type: 'varchar' })
  sourceLanguage!: string;

  @Column({ length: 64, name: 'category_code', type: 'varchar' })
  categoryCode!: string;

  @Column({ array: true, name: 'tag_codes', type: 'text' })
  tagCodes!: string[];

  @Column({ name: 'rights_declared', type: 'boolean' })
  rightsDeclared!: boolean;

  @Column({ length: 32, name: 'license_version', type: 'varchar' })
  licenseVersion!: string;

  @Column({ name: 'rights_declared_at', type: 'timestamptz' })
  rightsDeclaredAt!: Date;

  @Column({ length: 512, name: 'artifact_object_key', type: 'varchar' })
  artifactObjectKey!: string;

  @Column({ length: 64, name: 'artifact_checksum', type: 'char' })
  artifactChecksum!: string;

  @Column({ name: 'artifact_byte_length', type: 'integer' })
  artifactByteLength!: number;

  @Column({ name: 'artifact_schema_version', type: 'integer' })
  artifactSchemaVersion!: number;

  @Column({ type: 'integer' })
  width!: number;

  @Column({ type: 'integer' })
  height!: number;

  @Column({ name: 'palette_size', type: 'integer' })
  paletteSize!: number;

  @Column({ length: 512, name: 'preview_object_key', type: 'varchar' })
  previewObjectKey!: string;

  @Column({ length: 64, name: 'preview_checksum', type: 'char' })
  previewChecksum!: string;

  @Column({ length: 16, name: 'preview_phash', nullable: true, type: 'varchar' })
  previewPhash!: string | null;

  @Column({ name: 'metadata_valid', nullable: true, type: 'boolean' })
  metadataValid!: boolean | null;

  @Column({ name: 'metadata_errors', nullable: true, type: 'jsonb' })
  metadataErrors!: string[] | null;

  @Column({ name: 'technical_valid', nullable: true, type: 'boolean' })
  technicalValid!: boolean | null;

  @Column({ name: 'technical_errors', nullable: true, type: 'jsonb' })
  technicalErrors!: string[] | null;

  @Column({ name: 'moderation_evidence', nullable: true, type: 'jsonb' })
  moderationEvidence!: Record<string, unknown> | null;

  @Column({ name: 'similarity_evidence', nullable: true, type: 'jsonb' })
  similarityEvidence!: Array<{ submissionId: string; distance: number }> | null;

  @Column({ length: 32, type: 'varchar', default: 'precheck_pending' })
  status!: CatalogSubmissionStatus;

  @Column({ length: 32, name: 'rejection_reason', nullable: true, type: 'varchar' })
  rejectionReason!: CatalogRejectionReason | null;

  @Column({ name: 'rejection_note', nullable: true, type: 'text' })
  rejectionNote!: string | null;

  @Column({ name: 'initial_moderator_id', nullable: true, type: 'uuid' })
  initialModeratorId!: string | null;

  @Column({ name: 'community_pattern_id', nullable: true, type: 'uuid', unique: true })
  communityPatternId!: string | null;

  @Column({ name: 'precheck_completed_at', nullable: true, type: 'timestamptz' })
  precheckCompletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
