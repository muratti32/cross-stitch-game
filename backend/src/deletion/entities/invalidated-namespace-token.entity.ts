import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity({ name: 'invalidated_namespace_tokens', schema: 'deletion' })
@Index('IDX_invalidated_namespace_tokens_expires_at', ['expiresAt'])
export class InvalidatedNamespaceTokenEntity {
  @PrimaryColumn({ length: 64, name: 'token_hash', type: 'varchar' })
  tokenHash!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
