import {
  Check,
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'daily_color_action_counts', schema: 'economy' })
@Check(
  'CHK_daily_color_action_counts_principal_type',
  '"principal_type" IN (\'guest\', \'account\')',
)
export class DailyColorActionCountEntity {
  @PrimaryColumn({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: string;

  @PrimaryColumn({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @PrimaryColumn({ name: 'reward_day', type: 'date' })
  rewardDay!: string;

  @PrimaryColumn({ name: 'dmc_code', type: 'varchar', length: 16 })
  dmcCode!: string;

  @Column({ name: 'action_count', type: 'integer', default: 0 })
  actionCount!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
