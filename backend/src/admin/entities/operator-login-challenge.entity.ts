import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

// Bridges POST /admin/auth/login's mfa_required response to the TOTP/recovery
// step in POST /admin/auth/mfa. Single-use and short-lived.
@Entity({ name: 'operator_login_challenges', schema: 'admin' })
@Unique('UQ_operator_login_challenges_challenge_hash', ['challengeHash'])
export class OperatorLoginChallengeEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_operator_login_challenges',
  })
  id!: string;

  @Column({ name: 'operator_account_id', type: 'uuid' })
  operatorAccountId!: string;

  @Column({ name: 'challenge_hash', type: 'varchar', length: 64 })
  challengeHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', nullable: true, type: 'timestamptz' })
  consumedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
