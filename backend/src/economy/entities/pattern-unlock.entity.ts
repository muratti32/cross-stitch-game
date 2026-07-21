import { Check, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'pattern_unlocks', schema: 'economy' })
@Check(
  'CHK_pattern_unlocks_principal_type',
  '"principal_type" IN (\'guest\', \'account\')',
)
export class PatternUnlockEntity {
  @PrimaryColumn({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: string;

  @PrimaryColumn({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @PrimaryColumn({ name: 'pattern_id', type: 'uuid' })
  patternId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
