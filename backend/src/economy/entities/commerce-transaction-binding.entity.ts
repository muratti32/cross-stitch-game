import { Check, Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'commerce_transaction_bindings', schema: 'economy' })
@Check('CHK_commerce_transaction_bindings_environment', '"environment" IN (\'sandbox\', \'production\')')
@Check(
  'CHK_commerce_transaction_bindings_principal_type',
  '"principal_type" IN (\'account\', \'guest\')',
)
@Check('CHK_commerce_transaction_bindings_currency', '"currency" IN (\'coin\', \'ai_credit\')')
@Check(
  'CHK_commerce_transaction_bindings_owner',
  '("principal_type" = \'account\' AND "account_id" = "principal_id" AND "guest_installation_id" IS NULL) OR ("principal_type" = \'guest\' AND "guest_installation_id" = "principal_id" AND "account_id" IS NULL)',
)
export class CommerceTransactionBindingEntity {
  @PrimaryColumn({ name: 'environment', type: 'varchar', length: 16 })
  environment!: string; // 'sandbox' | 'production'

  @PrimaryColumn({ name: 'provider_transaction_id', type: 'varchar', length: 255 })
  providerTransactionId!: string;

  @Column({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: string; // 'account' or iOS Guest Installation Identity

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string; // Registered Account id or, once enabled, Guest Installation Identity id

  // CommerceOwner (ADR-0044/0045): exactly one mirrors principalId, enforced by
  // CHK_commerce_transaction_bindings_owner.
  @Column({ type: 'uuid', nullable: true, name: 'account_id' })
  accountId!: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'guest_installation_id' })
  guestInstallationId!: string | null;

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
