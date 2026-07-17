import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { OperatorRefreshTokenStatus } from './operator-refresh-token-status.enum';

@Entity({ name: 'operator_refresh_tokens', schema: 'admin' })
@Unique('UQ_operator_refresh_tokens_token_hash', ['tokenHash'])
@Index('IDX_operator_refresh_tokens_account_status', [
  'operatorAccountId',
  'status',
])
@Index('IDX_operator_refresh_tokens_family_id', ['familyId'])
@Check(
  'CHK_operator_refresh_tokens_status',
  '"status" IN (\'active\', \'rotated\', \'revoked\')',
)
export class OperatorRefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_operator_refresh_tokens',
  })
  id!: string;

  @Column({ name: 'operator_account_id', type: 'uuid' })
  operatorAccountId!: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;

  @Column({ name: 'family_id', type: 'uuid' })
  familyId!: string;

  @Column({
    default: OperatorRefreshTokenStatus.Active,
    length: 16,
    type: 'varchar',
  })
  status!: OperatorRefreshTokenStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'rotated_at', nullable: true, type: 'timestamptz' })
  rotatedAt!: Date | null;
}
