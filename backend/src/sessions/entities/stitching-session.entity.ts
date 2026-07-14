import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
} from 'typeorm';
import { SessionProgressFlagEntity } from './session-progress-flag.entity';

@Entity({ name: 'stitching_sessions', schema: 'sessions' })
export class StitchingSessionEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_stitching_sessions',
  })
  id!: string;

  @Column({ name: 'principal_type', type: 'varchar', length: 64 })
  principalType!: string;

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @Column({ name: 'pattern_id', type: 'uuid' })
  patternId!: string;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: 'active' | 'completed';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @OneToOne(() => SessionProgressFlagEntity, (flag) => flag.session)
  progressFlag?: SessionProgressFlagEntity;
}
