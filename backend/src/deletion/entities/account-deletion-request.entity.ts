import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AccountDeletionRequestStatus = 'pending' | 'cancelled' | 'finalized';

@Entity({ name: 'account_deletion_requests', schema: 'deletion' })
@Check(
  'CHK_account_deletion_requests_status',
  '"status" IN (\'pending\', \'cancelled\', \'finalized\')',
)
export class AccountDeletionRequestEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_account_deletion_requests',
  })
  id!: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId!: string;

  @Column({
    default: 'pending',
    length: 16,
    type: 'varchar',
  })
  status!: AccountDeletionRequestStatus;

  @CreateDateColumn({ name: 'requested_at', type: 'timestamptz' })
  requestedAt!: Date;

  @Column({ name: 'recovery_window_ends_at', type: 'timestamptz' })
  recoveryWindowEndsAt!: Date;

  @Column({ name: 'cancelled_at', nullable: true, type: 'timestamptz' })
  cancelledAt!: Date | null;

  @Column({ name: 'finalized_at', nullable: true, type: 'timestamptz' })
  finalizedAt!: Date | null;
}
