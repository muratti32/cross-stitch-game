import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'email_verification_codes', schema: 'auth' })
@Index('IDX_email_verification_codes_active_email', ['email'], {
  unique: true,
  where: '"consumed_at" IS NULL AND "superseded_at" IS NULL',
})
@Index('IDX_email_verification_codes_email', ['email'])
@Check('CHK_email_verification_codes_email_lowercase', '"email" = lower("email")')
export class EmailVerificationCodeEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_email_verification_codes',
  })
  id!: string;

  @Column({ length: 254, type: 'varchar' })
  email!: string;

  @Column({ length: 64, name: 'code_verifier', type: 'char' })
  codeVerifier!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ default: 0, type: 'integer' })
  attempts!: number;

  @Column({ name: 'max_attempts', type: 'integer' })
  maxAttempts!: number;

  @Column({ name: 'consumed_at', nullable: true, type: 'timestamptz' })
  consumedAt!: Date | null;

  @Column({ name: 'superseded_at', nullable: true, type: 'timestamptz' })
  supersededAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ length: 64, name: 'ip_hash', nullable: true, type: 'varchar' })
  ipHash!: string | null;
}
