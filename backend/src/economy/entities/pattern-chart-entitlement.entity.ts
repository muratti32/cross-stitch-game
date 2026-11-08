import { Check, Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type PatternChartEntitlementSource =
  | 'completion'
  | 'coin_spend'
  | 'promotion'
  | 'backfill';

/**
 * Right of a Registered Account to draw the Pattern Chart Image of an Official
 * Pattern (ADR-0068). Never deleted by Commerce Reversal, Catalog Withdrawal or
 * Safety Removal; only account deletion erases it.
 */
@Entity({ name: 'pattern_chart_entitlements', schema: 'economy' })
@Check(
  'CHK_pattern_chart_entitlements_source',
  '"source" IN (\'completion\', \'coin_spend\', \'promotion\', \'backfill\')',
)
export class PatternChartEntitlementEntity {
  @PrimaryColumn({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @PrimaryColumn({ name: 'pattern_id', type: 'uuid' })
  patternId!: string;

  @Column({ type: 'varchar', length: 32 })
  source!: PatternChartEntitlementSource;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
