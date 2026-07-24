import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// A username value released by Moderator Username Reset. Kept forever so the
// violating value can never be claimed again, even though no live
// creator_profiles row holds it once the reset happens.
@Entity({ name: 'reserved_usernames', schema: 'moderation' })
export class ReservedUsernameEntity {
  @PrimaryColumn({ length: 30, type: 'varchar' })
  username!: string;

  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
