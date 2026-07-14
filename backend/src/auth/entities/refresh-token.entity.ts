import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { PrincipalType } from './principal-type.enum';
import { RefreshTokenStatus } from './refresh-token-status.enum';

@Entity({ name: 'refresh_tokens', schema: 'auth' })
@Unique('UQ_refresh_tokens_token_hash', ['tokenHash'])
@Index('IDX_refresh_tokens_principal_status', [
  'principalType',
  'principalId',
  'status',
])
@Index('IDX_refresh_tokens_family_id', ['familyId'])
@Check(
  'CHK_refresh_tokens_status',
  '"status" IN (\'active\', \'rotated\', \'revoked\')',
)
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_refresh_tokens',
  })
  id!: string;

  @Column({ length: 32, name: 'principal_type', type: 'varchar' })
  principalType!: PrincipalType;

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @Column({ length: 64, name: 'token_hash', type: 'varchar' })
  tokenHash!: string;

  @Column({ name: 'family_id', type: 'uuid' })
  familyId!: string;

  @Column({
    default: RefreshTokenStatus.Active,
    length: 16,
    type: 'varchar',
  })
  status!: RefreshTokenStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'rotated_at', nullable: true, type: 'timestamptz' })
  rotatedAt!: Date | null;
}
