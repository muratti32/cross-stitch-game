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

import { OfficialPatternDraftStatus } from './official-pattern-draft-status.enum';

@Entity({ name: 'official_pattern_drafts', schema: 'admin' })
@Unique('UQ_official_pattern_drafts_processing_job_id', ['processingJobId'])
@Unique('UQ_official_pattern_drafts_published_pattern_id', ['publishedPatternId'])
@Index('IDX_official_pattern_drafts_status_created', ['status', 'createdAt'])
@Index('IDX_official_pattern_drafts_operator', ['createdByOperatorId', 'createdAt'])
@Check(
  'CHK_official_pattern_drafts_status',
  '"status" IN (\'pending\', \'processing\', \'ready\', \'failed\', \'published\', \'discarded\')',
)
@Check(
  'CHK_official_pattern_drafts_short_edge_cells',
  '"short_edge_cells" >= 20 AND "short_edge_cells" <= 300',
)
@Check(
  'CHK_official_pattern_drafts_max_colors',
  '"max_colors" >= 5 AND "max_colors" <= 60',
)
export class OfficialPatternDraftEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_official_pattern_drafts',
  })
  id!: string;

  @Column({ name: 'created_by_operator_id', type: 'uuid' })
  createdByOperatorId!: string;

  @Column({
    type: 'varchar',
    length: 16,
    default: OfficialPatternDraftStatus.Pending,
  })
  status!: OfficialPatternDraftStatus;

  @Column({ name: 'source_object_key', type: 'varchar', length: 512 })
  sourceObjectKey!: string;

  @Column({ name: 'source_checksum', type: 'char', length: 64 })
  sourceChecksum!: string;

  @Column({ name: 'source_byte_length', type: 'integer' })
  sourceByteLength!: number;

  @Column({ name: 'source_content_type', type: 'varchar', length: 64 })
  sourceContentType!: string;

  @Column({ name: 'source_width', type: 'integer' })
  sourceWidth!: number;

  @Column({ name: 'source_height', type: 'integer' })
  sourceHeight!: number;

  @Column({ name: 'short_edge_cells', type: 'integer' })
  shortEdgeCells!: number;

  @Column({ name: 'max_colors', type: 'integer' })
  maxColors!: number;

  @Column({ name: 'processing_job_id', nullable: true, type: 'uuid' })
  processingJobId!: string | null;

  @Column({ name: 'artifact_object_key', nullable: true, type: 'varchar', length: 512 })
  artifactObjectKey!: string | null;

  @Column({ name: 'artifact_checksum', nullable: true, type: 'char', length: 64 })
  artifactChecksum!: string | null;

  @Column({ name: 'artifact_byte_length', nullable: true, type: 'integer' })
  artifactByteLength!: number | null;

  @Column({ name: 'artifact_schema_version', nullable: true, type: 'integer' })
  artifactSchemaVersion!: number | null;

  @Column({ name: 'preview_object_key', nullable: true, type: 'varchar', length: 512 })
  previewObjectKey!: string | null;

  @Column({ nullable: true, type: 'integer' })
  width!: number | null;

  @Column({ nullable: true, type: 'integer' })
  height!: number | null;

  @Column({ name: 'palette_size', nullable: true, type: 'integer' })
  paletteSize!: number | null;

  @Column({ name: 'stitchable_cell_count', nullable: true, type: 'integer' })
  stitchableCellCount!: number | null;

  @Column({ name: 'failure_reason', nullable: true, type: 'text' })
  failureReason!: string | null;

  @Column({ name: 'published_pattern_id', nullable: true, type: 'uuid' })
  publishedPatternId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
