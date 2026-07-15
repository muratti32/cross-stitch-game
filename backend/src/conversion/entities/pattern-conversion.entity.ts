import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  Unique,
} from 'typeorm';

export type ConversionProfile = 'easy' | 'standard' | 'detailed' | 'custom';

@Entity({ name: 'pattern_conversions', schema: 'conversion' })
@Unique('UQ_pattern_conversions_target_pattern_id', ['targetPatternId'])
@Check(
  'CHK_pattern_conversions_profile',
  '"profile" IN (\'easy\', \'standard\', \'detailed\', \'custom\')',
)
export class PatternConversionEntity {
  @PrimaryColumn({ name: 'processing_job_id', type: 'uuid' })
  processingJobId!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ name: 'target_pattern_id', type: 'uuid' })
  targetPatternId!: string;

  @Column({ name: 'upload_object_key', type: 'varchar', length: 512 })
  uploadObjectKey!: string;

  @Column({ name: 'upload_checksum', type: 'char', length: 64 })
  uploadChecksum!: string;

  @Column({ name: 'upload_byte_length', type: 'integer' })
  uploadByteLength!: number;

  @Column({ name: 'upload_content_type', type: 'varchar', length: 64 })
  uploadContentType!: string;

  @Column({ type: 'varchar', length: 16 })
  profile!: ConversionProfile;

  @Column({ name: 'short_edge_cells', type: 'integer' })
  shortEdgeCells!: number;

  @Column({ name: 'max_colors', type: 'integer' })
  maxColors!: number;

  @Column({ name: 'framed_width', type: 'integer' })
  framedWidth!: number;

  @Column({ name: 'framed_height', type: 'integer' })
  framedHeight!: number;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
