import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import { EMAIL_SENDER, EmailDelivery, EmailSender } from './email-sender.interface';
import {
  EmailOutboxEntity,
  EmailOutboxPayload,
  EmailOtpOutboxPayload,
  ModerationNoticeOutboxPayload,
} from './email-outbox.entity';

const DEFAULT_EMAIL_OUTBOX_BATCH_SIZE = 25;

@Injectable()
export class EmailOutboxDispatcherService {
  private readonly logger = new Logger(EmailOutboxDispatcherService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
  ) {}

  async dispatchOnce(
    batchSize: number = DEFAULT_EMAIL_OUTBOX_BATCH_SIZE,
  ): Promise<number> {
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new RangeError(
        'Email outbox dispatcher batch size must be a positive integer',
      );
    }

    return this.runInTransaction(async (manager) => {
      const outboxRows = await manager
        .getRepository(EmailOutboxEntity)
        .createQueryBuilder('outbox')
        .where('outbox.dispatched_at IS NULL')
        .orderBy('outbox.created_at', 'ASC')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .take(batchSize)
        .getMany();

      for (const outbox of outboxRows) {
        await this.sender.send(deliveryFor(outbox));
        const updated = await manager.getRepository(EmailOutboxEntity).update(
          { dispatchedAt: IsNull(), id: outbox.id },
          {
            attempts: outbox.attempts + 1,
            dispatchedAt: new Date(),
          },
        );
        if (updated.affected !== 1) {
          throw new Error(`Email outbox ${outbox.id} could not be marked dispatched`);
        }
      }
      return outboxRows.length;
    });
  }

  private async runInTransaction(
    work: (manager: EntityManager) => Promise<number>,
  ): Promise<number> {
    const queryRunner = this.dataSource.createQueryRunner();
    let connected = false;
    try {
      await queryRunner.connect();
      connected = true;
      await queryRunner.startTransaction();
      const result = await work(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (error: unknown) {
      if (queryRunner.isTransactionActive) {
        try {
          await queryRunner.rollbackTransaction();
        } catch (rollbackError: unknown) {
          this.logger.error(
            `Email outbox rollback failed: ${errorMessage(rollbackError)}`,
            errorStack(rollbackError),
          );
        }
      }
      this.logger.error(
        `Email outbox dispatch failed: ${errorMessage(error)}`,
        errorStack(error),
      );
      throw error;
    } finally {
      if (connected) {
        await queryRunner.release();
      }
    }
  }
}

function deliveryFor(outbox: EmailOutboxEntity): EmailDelivery {
  if (outbox.template === 'email_otp') {
    const payload = assertEmailOtpPayload(outbox.payload);
    if (outbox.dedupeKey !== payload.codeId) {
      throw new Error(`Email outbox ${outbox.id} has an invalid delivery payload`);
    }
    return {
      code: payload.code,
      codeId: payload.codeId,
      deliveryId: outbox.dedupeKey,
      template: 'email_otp',
      toEmail: outbox.toEmail,
    };
  }
  const payload = assertModerationNoticePayload(outbox.payload);
  if (outbox.dedupeKey !== `moderation_notice:${payload.noticeId}`) {
    throw new Error(`Email outbox ${outbox.id} has an invalid delivery payload`);
  }
  return {
    deliveryId: outbox.dedupeKey,
    noticeId: payload.noticeId,
    patternId: payload.patternId,
    patternTitle: payload.patternTitle,
    reason: payload.reason,
    template: 'moderation_notice',
    toEmail: outbox.toEmail,
  };
}

function assertEmailOtpPayload(payload: EmailOutboxPayload): EmailOtpOutboxPayload {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('code' in payload) ||
    typeof payload.code !== 'string' ||
    !/^\d{6}$/.test(payload.code) ||
    !('codeId' in payload) ||
    typeof payload.codeId !== 'string'
  ) {
    throw new Error('Email outbox payload is invalid');
  }
  return payload;
}

function assertModerationNoticePayload(
  payload: EmailOutboxPayload,
): ModerationNoticeOutboxPayload {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('noticeId' in payload) ||
    typeof payload.noticeId !== 'string' ||
    !('patternId' in payload) ||
    typeof payload.patternId !== 'string' ||
    !('patternTitle' in payload) ||
    typeof payload.patternTitle !== 'string' ||
    !('reason' in payload) ||
    typeof payload.reason !== 'string' ||
    payload.reason.trim().length === 0
  ) {
    throw new Error('Email outbox payload is invalid');
  }
  return payload;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
