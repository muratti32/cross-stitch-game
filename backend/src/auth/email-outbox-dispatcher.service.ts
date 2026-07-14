import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import { EMAIL_SENDER, EmailSender } from './email-sender.interface';
import { EmailOutboxEntity, EmailOtpOutboxPayload } from './email-outbox.entity';

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
        const payload = assertEmailOtpPayload(outbox.payload);
        if (outbox.template !== 'email_otp' || outbox.dedupeKey !== payload.codeId) {
          throw new Error(`Email outbox ${outbox.id} has an invalid delivery payload`);
        }
        await this.sender.send({
          code: payload.code,
          codeId: payload.codeId,
          toEmail: outbox.toEmail,
        });
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

function assertEmailOtpPayload(payload: EmailOtpOutboxPayload): EmailOtpOutboxPayload {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload.code !== 'string' ||
    !/^\d{6}$/.test(payload.code) ||
    typeof payload.codeId !== 'string'
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
