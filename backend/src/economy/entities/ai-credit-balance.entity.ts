import { Check, Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'ai_credit_balances', schema: 'economy' })
@Check(
  'CHK_ai_credit_balances_principal_type',
  '"principal_type" IN (\'guest\', \'account\')',
)
export class AiCreditBalanceEntity {
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
