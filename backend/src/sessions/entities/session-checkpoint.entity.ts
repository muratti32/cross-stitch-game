import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'session_checkpoints', schema: 'sessions' })
export class SessionCheckpointEntity {
  @PrimaryColumn({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @PrimaryColumn({ type: 'bigint' })
  revision!: string;

  @Column({ name: 'packed_bitmap', type: 'bytea' })
  packedBitmap!: Buffer;

  @Column({ type: 'char', length: 64 })
  checksum!: string;

  @Column({ name: 'format_version', type: 'integer', default: 1 })
  formatVersion!: number;

  @Column({ name: 'device_watermarks', type: 'jsonb', default: () => "'{}'" })
  deviceWatermarks!: Record<string, number>;

  @Column({ name: 'terminal_completed', type: 'boolean', default: false })
  terminalCompleted!: boolean;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
