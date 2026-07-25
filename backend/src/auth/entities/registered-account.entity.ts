import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { RegisteredAccountStatus } from './registered-account-status.enum';

@Entity({ name: 'registered_accounts', schema: 'auth' })
@Check(
  'CHK_registered_accounts_status',
  '"status" IN (\'active\', \'closed\', \'closing\', \'deleted\')',
)
export class RegisteredAccountEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_registered_accounts',
  })
  id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({
    default: RegisteredAccountStatus.Active,
    length: 16,
    type: 'varchar',
  })
  status!: RegisteredAccountStatus;
}
