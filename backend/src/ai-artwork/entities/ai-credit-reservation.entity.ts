import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type AiCreditReservationStatus = 'reserved' | 'captured' | 'released';

@Entity({ name: 'ai_credit_reservations', schema: 'ai' })
@Index('UQ_ai_credit_reservations_processing_job', ['processingJobId'], { unique: true })
export class AiCreditReservationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'account_id', type: 'uuid', nullable: true }) accountId!: string | null;
  @Column({ name: 'guest_installation_id', type: 'uuid', nullable: true }) guestInstallationId!: string | null;
  @Column({ name: 'processing_job_id', type: 'uuid' }) processingJobId!: string;
  @Column({ type: 'varchar', length: 12 }) status!: AiCreditReservationStatus;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
