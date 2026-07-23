import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'ad_attempts', schema: 'economy' })
@Index('IDX_ad_attempts_principal_created', ['principalType', 'principalId', 'createdAt'])
@Check('CHK_ad_attempts_principal_type', '"principal_type" IN (\'guest\', \'account\')')
export class AdAttemptEntity {
  @PrimaryGeneratedColumn('uuid', {
    name: 'nonce',
    primaryKeyConstraintName: 'PK_ad_attempts',
  })
  nonce!: string;

  @Column({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: string;

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @Column({ name: 'placement', type: 'varchar', length: 64 })
  placement!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
