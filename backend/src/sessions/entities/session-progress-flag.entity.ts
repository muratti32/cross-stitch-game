import { Entity, PrimaryColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { StitchingSessionEntity } from './stitching-session.entity';

@Entity({ name: 'session_progress_flags', schema: 'sessions' })
export class SessionProgressFlagEntity {
  @PrimaryColumn({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @Column({ name: 'has_any_progress', type: 'boolean', default: false })
  hasAnyProgress!: boolean;

  @OneToOne(() => StitchingSessionEntity, (session) => session.progressFlag, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'session_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'FK_session_progress_flags_sessions',
  })
  session!: StitchingSessionEntity;
}
