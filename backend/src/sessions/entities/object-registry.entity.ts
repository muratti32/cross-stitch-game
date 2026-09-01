import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'object_registry', schema: 'storage' })
export class ObjectRegistryEntity {
  @PrimaryColumn({ name: 'object_key', type: 'varchar', length: 512 })
  objectKey!: string;

  @Column({ type: 'char', length: 64 })
  checksum!: string;

  @Column({ name: 'byte_length', type: 'integer' })
  byteLength!: number;

  @Column({ type: 'varchar', length: 32 })
  state!: 'uploading' | 'verified' | 'committed' | 'available';

  @Column({ type: 'boolean', default: false })
  missing!: boolean;

  /**
   * Last time the object was checked against remote storage. Drives the bounded
   * reconciler sweep; null means the object has never been verified.
   */
  @Column({ name: 'last_verified_at', type: 'timestamptz', nullable: true })
  lastVerifiedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
