import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'gameplay_events', schema: 'economy' })
@Check(
  'CHK_gameplay_events_principal_type',
  '"principal_type" IN (\'guest\', \'account\')',
)
@Check(
  'CHK_gameplay_events_kind',
  '"kind" IN (\'stitch_action\', \'color_completion\')',
)
export class GameplayEventEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: string;

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @Column({ name: 'reward_day', type: 'date' })
  rewardDay!: string;

  @Column({ name: 'kind', type: 'varchar', length: 24 })
  kind!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @Column({ name: 'dmc_code', type: 'varchar', length: 16 })
  dmcCode!: string;

  @Column({ name: 'client_seq', type: 'bigint' })
  clientSeq!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz', nullable: true })
  occurredAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
