import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type CreatorProfileAuditEventActorType =
  | 'account'
  | 'operator'
  | 'system';

// The moderation-event stream of the Creator Profile Audit. Unlike
// CreatorProfileAuditEntity, which snapshots profile VALUES per version, these
// rows record report/case events (actor, reason, time) that are not tied to a
// profile version. Append-only (enforced by a database trigger).
@Entity({ name: 'creator_profile_audit_events', schema: 'moderation' })
@Index('IDX_creator_profile_audit_events_profile', ['profileId', 'createdAt'])
@Check(
  'CHK_creator_profile_audit_events_actor_type',
  '"actor_type" IN (\'account\', \'operator\', \'system\')',
)
export class CreatorProfileAuditEventEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_creator_profile_audit_events',
  })
  id!: string;

  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @Column({ name: 'investigation_id', nullable: true, type: 'uuid' })
  investigationId!: string | null;

  @Column({ name: 'report_id', nullable: true, type: 'uuid' })
  reportId!: string | null;

  @Column({ length: 48, name: 'event_type', type: 'varchar' })
  eventType!: string;

  @Column({ length: 16, name: 'actor_type', type: 'varchar' })
  actorType!: CreatorProfileAuditEventActorType;

  @Column({ name: 'actor_id', nullable: true, type: 'uuid' })
  actorId!: string | null;

  @Column({ length: 64, nullable: true, type: 'varchar' })
  reason!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
