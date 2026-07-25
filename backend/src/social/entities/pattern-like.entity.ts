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
import { PatternEntity } from '../../catalog/entities';

@Entity({ name: 'pattern_likes', schema: 'social' })
@Index('UQ_pattern_likes_account_pattern', ['accountId', 'patternId'], { unique: true })
@Index('IDX_pattern_likes_account_created_at', ['accountId', 'createdAt'])
export class PatternLikeEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_pattern_likes',
  })
  id!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({ name: 'pattern_id', type: 'uuid' })
  patternId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => RegisteredAccountEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'account_id',
    foreignKeyConstraintName: 'FK_pattern_likes_account',
  })
  account!: RegisteredAccountEntity;

  @ManyToOne(() => PatternEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'pattern_id',
    foreignKeyConstraintName: 'FK_pattern_likes_pattern',
  })
  pattern!: PatternEntity;
}
