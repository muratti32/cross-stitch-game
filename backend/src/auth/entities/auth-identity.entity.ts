import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { RegisteredAccountEntity } from './registered-account.entity';

@Entity({ name: 'auth_identities', schema: 'auth' })
@Unique('UQ_auth_identities_provider_email', ['provider', 'email'])
@Unique('UQ_auth_identities_provider_subject', ['provider', 'subject'])
@Check('CHK_auth_identities_email_lowercase', '"email" = lower("email")')
@Check('CHK_auth_identities_provider', '"provider" = \'email\'')
export class AuthIdentityEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_auth_identities',
  })
  id!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @ManyToOne(() => RegisteredAccountEntity, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({
    foreignKeyConstraintName: 'FK_auth_identities_account',
    name: 'account_id',
  })
  account!: RegisteredAccountEntity;

  @Column({ length: 32, type: 'varchar' })
  provider!: 'email';

  @Column({ length: 254, type: 'varchar' })
  email!: string;

  @Column({ length: 254, type: 'varchar' })
  subject!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
