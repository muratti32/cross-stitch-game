import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'creator_profiles', schema: 'moderation' })
@Index('UQ_creator_profiles_account', ['accountId'], { unique: true })
@Index('UQ_creator_profiles_username', ['username'], { unique: true })
@Check(
  'CHK_creator_profiles_username',
  '"username" = lower("username") AND "username" ~ \'^[a-z0-9_]{3,30}$\'',
)
@Check(
  'CHK_creator_profiles_display_name',
  'char_length(btrim("display_name")) BETWEEN 1 AND 50',
)
export class CreatorProfileEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_creator_profiles',
  })
  id!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ length: 30, type: 'varchar' })
  username!: string;

  @Column({ length: 50, name: 'display_name', type: 'varchar' })
  displayName!: string;

  @Column({ length: 512, name: 'avatar_object_key', nullable: true, type: 'varchar' })
  avatarObjectKey!: string | null;

  @Column({ length: 32, name: 'avatar_content_type', nullable: true, type: 'varchar' })
  avatarContentType!: string | null;

  @Column({ length: 64, name: 'avatar_checksum', nullable: true, type: 'varchar' })
  avatarChecksum!: string | null;

  @Column({ default: 1, type: 'integer' })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
