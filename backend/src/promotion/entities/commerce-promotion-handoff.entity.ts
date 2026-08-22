import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

export type CommercePromotionHandoffState = 'pending' | 'processing' | 'acknowledged' | 'failed';

@Entity({ name: 'commerce_promotion_handoffs', schema: 'promotion' })
@Unique('UQ_commerce_promotion_handoffs_guest_account', ['guestId', 'accountId'])
export class CommercePromotionHandoffEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'guest_id', type: 'uuid' }) guestId!: string;
  @Column({ name: 'account_id', type: 'uuid' }) accountId!: string;
  @Column({ name: 'processing_job_id', type: 'uuid', nullable: true }) processingJobId!: string | null;
  @Column({ type: 'varchar', length: 20, default: 'pending' }) state!: CommercePromotionHandoffState;
  @Column({ name: 'attempt_count', type: 'integer', default: 0 }) attemptCount!: number;
  @Column({ name: 'last_failure_reason', type: 'text', nullable: true }) lastFailureReason!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
