import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { RegisteredAccountEntity } from '../../auth/entities';
import { CreatorProfileEntity } from '../../creator-profile/entities';

@Entity({ name: 'creator_blocks', schema: 'social' })
@Index('UQ_creator_blocks_account_creator', ['accountId', 'creatorProfileId'], { unique: true })
@Index('IDX_creator_blocks_account', ['accountId'])
export class CreatorBlockEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_creator_blocks',
  })
  id!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ name: 'creator_profile_id', type: 'uuid' })
  creatorProfileId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => RegisteredAccountEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'account_id',
    foreignKeyConstraintName: 'FK_creator_blocks_account',
  })
  account!: RegisteredAccountEntity;

  @ManyToOne(() => CreatorProfileEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'creator_profile_id',
    foreignKeyConstraintName: 'FK_creator_blocks_creator_profile',
  })
  creatorProfile!: CreatorProfileEntity;
}
