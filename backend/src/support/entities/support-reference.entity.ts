import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type SupportPrincipalType = 'account' | 'guest';

@Entity({ name: 'support_references', schema: 'support' })
@Index('UQ_support_references_code', ['code'], { unique: true })
@Index('IDX_support_references_principal', ['principalType', 'principalId'])
@Check('CHK_support_references_principal_type', '"principal_type" IN (\'account\', \'guest\')')
export class SupportReferenceEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_support_references',
  })
  id!: string;

  @Column({ type: 'varchar', length: 17 })
  code!: string;

  @Column({ name: 'principal_type', type: 'varchar', length: 16 })
  principalType!: SupportPrincipalType;

  @Column({ name: 'principal_id', type: 'uuid' })
  principalId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
