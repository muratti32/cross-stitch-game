import { Check, Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'coin_balances', schema: 'economy' })
@Check(
  'CHK_coin_balances_principal_type',
  '"principal_type" IN (\'guest\', \'account\')',
)
export class CoinBalanceEntity {
  @PrimaryColumn({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: string;

  @PrimaryColumn({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  // Stored as bigint; TypeORM returns it as a string to avoid precision loss.
  @Column({ type: 'bigint', default: 0 })
  balance!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
