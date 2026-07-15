import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'session_sync_state', schema: 'sessions' })
export class SessionSyncStateEntity {
  @PrimaryColumn({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'bigint', default: '0' })
  revision!: string;

  @Column({ name: 'terminal_completed_at', type: 'timestamptz', nullable: true })
  terminalCompletedAt!: Date | null;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
