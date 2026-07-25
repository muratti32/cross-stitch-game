import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm';

import type { GameplayEventKind, GameplayEventPayload } from '../events.schema';

@Entity({ name: 'gameplay_events', schema: 'analytics' })
@Check(
  'CHK_analytics_gameplay_events_principal_type',
  '"principal_type" IN (\'guest\', \'account\')',
)
export class AnalyticsGameplayEventEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @PrimaryColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: 'guest' | 'account';

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @Column({ type: 'varchar', length: 64 })
  kind!: GameplayEventKind;

  @Column({ type: 'jsonb' })
  payload!: GameplayEventPayload;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;
}
