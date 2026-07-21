import {
  Check,
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'reward_day_pools', schema: 'economy' })
@Check(
  'CHK_reward_day_pools_principal_type',
  '"principal_type" IN (\'guest\', \'account\')',
)
@Check(
  'CHK_reward_day_pools_coins_consumed',
  '"coins_consumed" BETWEEN 0 AND 30',
)
@Check('CHK_reward_day_pools_ads_completed', '"ads_completed" BETWEEN 0 AND 3')
export class RewardDayPoolEntity {
  @PrimaryColumn({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: string;

  @PrimaryColumn({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  // Reward Day as a UTC calendar date (00:00 UTC boundary, ADR-0011).
  @PrimaryColumn({ name: 'reward_day', type: 'date' })
  rewardDay!: string;

  @Column({ name: 'coins_consumed', type: 'integer', default: 0 })
  coinsConsumed!: number;

  @Column({ name: 'ads_completed', type: 'integer', default: 0 })
  adsCompleted!: number;

  @Column({ name: 'premium_claimed', type: 'boolean', default: false })
  premiumClaimed!: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
