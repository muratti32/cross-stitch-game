import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToMany,
  JoinTable,
  Check,
} from 'typeorm';
import { TagEntity } from './tag.entity';

export type PatternUnlockPriceTier = 'small' | 'medium' | 'large' | null;
export type PatternStatus = 'available' | 'withdrawn' | 'removed';
export type PatternVisibility = 'catalog' | 'personal';

@Entity({ name: 'patterns', schema: 'catalog' })
@Check('CHK_patterns_unlock_price_tier', '"unlock_price_tier" IN (\'small\', \'medium\', \'large\') OR "unlock_price_tier" IS NULL')
@Check('CHK_patterns_status', '"status" IN (\'available\', \'withdrawn\', \'removed\')')
@Check(
  'CHK_patterns_visibility_owner',
  '("visibility" = \'catalog\' AND "owner_account_id" IS NULL) OR ("visibility" = \'personal\' AND "owner_account_id" IS NOT NULL)',
)
export class PatternEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_patterns',
  })
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ name: 'creator_name', type: 'varchar', length: 255 })
  creatorName!: string;

  @Column({ name: 'category_code', type: 'varchar', length: 64 })
  categoryCode!: string;

  @Column({ type: 'integer' })
  width!: number;

  @Column({ type: 'integer' })
  height!: number;

  @Column({ name: 'palette_size', type: 'integer' })
  paletteSize!: number;

  @Column({ name: 'artifact_object_key', type: 'varchar', length: 512 })
  artifactObjectKey!: string;

  @Column({ name: 'artifact_checksum', type: 'char', length: 64 })
  artifactChecksum!: string;

  @Column({ name: 'artifact_byte_length', type: 'integer' })
  artifactByteLength!: number;

  @Column({ name: 'artifact_schema_version', type: 'integer' })
  artifactSchemaVersion!: number;

  @Column({ name: 'preview_object_key', type: 'varchar', length: 512 })
  previewObjectKey!: string;

  @Column({
    name: 'unlock_price_tier',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  unlockPriceTier!: PatternUnlockPriceTier;

  @Column({
    type: 'varchar',
    length: 16,
    default: 'available',
  })
  status!: PatternStatus;

  @Column({ default: 'catalog', length: 16, type: 'varchar' })
  visibility!: PatternVisibility;

  @Column({ name: 'owner_account_id', nullable: true, type: 'uuid' })
  ownerAccountId!: string | null;

  @Column({
    name: 'published_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  publishedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToMany(() => TagEntity)
  @JoinTable({
    name: 'pattern_tags',
    schema: 'catalog',
    joinColumn: {
      name: 'pattern_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'FK_pattern_tags_patterns',
    },
    inverseJoinColumn: {
      name: 'tag_code',
      referencedColumnName: 'code',
      foreignKeyConstraintName: 'FK_pattern_tags_tags',
    },
  })
  tags!: TagEntity[];
}
