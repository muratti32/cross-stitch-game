import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { OperatorAccountEntity } from './operator-account.entity';

@Entity({ name: 'operator_recovery_codes', schema: 'admin' })
@Unique('UQ_operator_recovery_codes_code_hash', ['codeHash'])
@Index('IDX_operator_recovery_codes_account', ['operatorAccountId'])
export class OperatorRecoveryCodeEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_operator_recovery_codes',
  })
  id!: string;

  @Column({ name: 'operator_account_id', type: 'uuid' })
  operatorAccountId!: string;

  @ManyToOne(() => OperatorAccountEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'operator_account_id',
    foreignKeyConstraintName: 'FK_operator_recovery_codes_account',
  })
  operatorAccount!: OperatorAccountEntity;

  @Column({ name: 'code_hash', type: 'varchar', length: 64 })
  codeHash!: string;

  @Column({ name: 'used_at', nullable: true, type: 'timestamptz' })
  usedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
