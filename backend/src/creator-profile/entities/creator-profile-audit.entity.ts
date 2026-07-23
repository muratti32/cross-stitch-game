import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type CreatorProfileAuditActorType = 'account' | 'operator' | 'system';

@Entity({ name: 'creator_profile_audit', schema: 'moderation' })
@Index('UQ_creator_profile_audit_version', ['profileId', 'version'], {
  unique: true,
})
@Check(
  'CHK_creator_profile_audit_actor_type',
  '"actor_type" IN (\'account\', \'operator\', \'system\')',
)
export class CreatorProfileAuditEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_creator_profile_audit',
  })
  id!: string;

  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @Column({ type: 'integer' })
  version!: number;

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

  @Column({ length: 16, name: 'actor_type', type: 'varchar' })
  actorType!: CreatorProfileAuditActorType;

  @Column({ name: 'actor_id', nullable: true, type: 'uuid' })
  actorId!: string | null;

  @Column({ length: 64, type: 'varchar' })
  reason!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
