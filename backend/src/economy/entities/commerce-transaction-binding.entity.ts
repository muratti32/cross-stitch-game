import { Check, Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'commerce_transaction_bindings', schema: 'economy' })
@Check('CHK_commerce_transaction_bindings_environment', '"environment" IN (\'sandbox\', \'production\')')
@Check('CHK_commerce_transaction_bindings_principal_type', '"principal_type" = \'account\'')
@Check('CHK_commerce_transaction_bindings_currency', '"currency" IN (\'coin\', \'ai_credit\')')
export class CommerceTransactionBindingEntity {
  @PrimaryColumn({ name: 'environment', type: 'varchar', length: 16 })
  environment!: string; // 'sandbox' | 'production'

  @PrimaryColumn({ name: 'provider_transaction_id', type: 'varchar', length: 255 })
  providerTransactionId!: string;

  @Column({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: string; // always 'account' — Guests cannot purchase (ADR-0011)

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string; // Registered Account id

  @Column({ name: 'product_id', type: 'varchar', length: 64 })
  productId!: string;

  @Column({ type: 'varchar', length: 16 })
  currency!: string; // 'coin' | 'ai_credit' — which ledger the grant landed in

  @Column({ name: 'granted_amount', type: 'bigint' })
  grantedAmount!: string;

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
