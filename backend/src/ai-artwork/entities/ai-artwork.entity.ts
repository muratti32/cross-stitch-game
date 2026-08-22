import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type ArtworkAspect = 'square' | 'portrait_4_3' | 'landscape_4_3';
export type AiArtworkStatus = 'pending' | 'submitting' | 'submitted' | 'delivered' | 'safety_rejected' | 'failed' | 'deleted' | 'cancelled';

@Entity({ name: 'ai_artworks', schema: 'ai' })
@Index('UQ_ai_artworks_processing_job', ['processingJobId'], { unique: true })
@Index('UQ_ai_artworks_provider_request', ['providerRequestId'], { unique: true, where: '"provider_request_id" IS NOT NULL' })
export class AiArtworkEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'account_id', type: 'uuid', nullable: true }) accountId!: string | null;
  @Column({ name: 'guest_installation_id', type: 'uuid', nullable: true }) guestInstallationId!: string | null;
  @Column({ name: 'processing_job_id', type: 'uuid' }) processingJobId!: string;
  @Column({ type: 'text' }) prompt!: string;
  @Column({ type: 'varchar', length: 20 }) aspect!: ArtworkAspect;
  @Column({ type: 'varchar', length: 24 }) status!: AiArtworkStatus;
  @Column({ name: 'provider_request_key', type: 'uuid' }) providerRequestKey!: string;
  @Column({ name: 'provider_request_id', type: 'varchar', length: 255, nullable: true }) providerRequestId!: string | null;
  @Column({ name: 'image_object_key', type: 'varchar', length: 512, nullable: true }) imageObjectKey!: string | null;
  @Column({ name: 'image_content_type', type: 'varchar', length: 128, nullable: true }) imageContentType!: string | null;
  @Column({ name: 'image_checksum', type: 'varchar', length: 64, nullable: true }) imageChecksum!: string | null;
  @Column({ name: 'image_byte_length', type: 'bigint', nullable: true }) imageByteLength!: string | null;
  @Column({ name: 'failure_reason', type: 'text', nullable: true }) failureReason!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
