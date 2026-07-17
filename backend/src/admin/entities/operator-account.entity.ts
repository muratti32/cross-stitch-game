import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { OperatorRole } from './operator-role.enum';

// Operator Accounts are a fully game-owned staff identity: no relationship to
// auth.registered_accounts, auth.guest_installations, or any Firebase
// identity. A player credential can never resolve to a row in this table.
@Entity({ name: 'operator_accounts', schema: 'admin' })
@Unique('UQ_operator_accounts_email', ['email'])
@Check('CHK_operator_accounts_role', '"role" IN (\'owner\')')
export class OperatorAccountEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_operator_accounts',
  })
  id!: string;

  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ name: 'totp_secret_encrypted', type: 'text' })
  totpSecretEncrypted!: string;

  @Column({ type: 'varchar', length: 32, default: OperatorRole.Owner })
  role!: OperatorRole;

  @Column({ type: 'boolean', default: false })
  disabled!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
