import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { GuestInstallationStatus } from './guest-installation-status.enum';

@Entity({ name: 'guest_installations', schema: 'auth' })
@Unique('UQ_guest_installations_installation_key_hash', [
  'installationKeyHash',
])
@Check(
  'CHK_guest_installations_status',
  '"status" IN (\'active\', \'revoked\')',
)
export class GuestInstallationEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_guest_installations',
  })
  id!: string;

  @Column({ length: 64, name: 'installation_key_hash', type: 'varchar' })
  installationKeyHash!: string;

  @Column({ length: 255, name: 'credential_hash', type: 'varchar' })
  credentialHash!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({
    default: () => 'CURRENT_TIMESTAMP',
    name: 'last_seen_at',
    type: 'timestamptz',
  })
  lastSeenAt!: Date;

  @Column({
    default: GuestInstallationStatus.Active,
    length: 16,
    type: 'varchar',
  })
  status!: GuestInstallationStatus;
}
