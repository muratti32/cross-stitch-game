import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export interface EmailOtpOutboxPayload {
  // The raw OTP lives in this internal outbox row so an at-least-once retry
  // re-delivers the SAME code (never a distinct one). It is single-use and
  // expires in minutes; it is never written to logs, responses, or Sentry.
  code: string;
  codeId: string;
}

export interface ModerationNoticeOutboxPayload {
  noticeId: string;
  patternId: string;
  patternTitle: string;
  reason: string;
}

export type EmailOutboxPayload =
  | EmailOtpOutboxPayload
  | ModerationNoticeOutboxPayload;

@Entity({ name: 'email_outbox', schema: 'notifications' })
@Index('IDX_email_outbox_undispatched', ['createdAt', 'id'], {
  where: '"dispatched_at" IS NULL',
})
@Unique('UQ_email_outbox_dedupe_key', ['dedupeKey'])
export class EmailOutboxEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_email_outbox',
  })
  id!: string;

  @Column({ length: 128, name: 'dedupe_key', type: 'varchar' })
  dedupeKey!: string;

  @Column({ length: 254, name: 'to_email', type: 'varchar' })
  toEmail!: string;

  @Column({ length: 32, type: 'varchar' })
  template!: 'email_otp' | 'moderation_notice';

  @Column({ type: 'jsonb' })
  payload!: EmailOutboxPayload;

  @Column({ name: 'dispatched_at', nullable: true, type: 'timestamptz' })
  dispatchedAt!: Date | null;

  @Column({ default: 0, type: 'integer' })
  attempts!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
