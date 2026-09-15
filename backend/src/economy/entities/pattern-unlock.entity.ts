import { Check, Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type PatternUnlockSource = 'coin_spend' | 'grandfathered';

@Entity({ name: 'pattern_unlocks', schema: 'economy' })
@Check(
  'CHK_pattern_unlocks_principal_type',
  '"principal_type" IN (\'guest\', \'account\')',
)
@Check(
  'CHK_pattern_unlocks_source',
  '"source" IN (\'coin_spend\', \'grandfathered\')',
)
export class PatternUnlockEntity {
  @PrimaryColumn({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: string;

  @PrimaryColumn({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @PrimaryColumn({ name: 'pattern_id', type: 'uuid' })
  patternId!: string;

  @Column({
    type: 'varchar',
    length: 32,
    default: 'coin_spend',
  })
  source!: PatternUnlockSource;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
