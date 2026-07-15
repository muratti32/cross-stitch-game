import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'session_device_watermarks', schema: 'sessions' })
export class SessionDeviceWatermarkEntity {
  @PrimaryColumn({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @PrimaryColumn({ name: 'device_id', type: 'uuid' })
  deviceId!: string;

  @Column({ name: 'applied_through_seq', type: 'bigint', default: '0' })
  appliedThroughSeq!: string;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
