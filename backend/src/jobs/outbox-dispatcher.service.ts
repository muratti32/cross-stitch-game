import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, IsNull } from 'typeorm';

import {
  JobOutboxEntity,
  ProcessingJobEntity,
  ProcessingJobStatus,
} from './entities';
import {
  CONVERSION_JOB_EVENT_NAME,
  DEFAULT_OUTBOX_BATCH_SIZE,
  DEMO_JOB_EVENT_NAME,
  DEMO_JOBS_QUEUE_NAME,
} from './jobs.constants';
import { DemoJobsQueueService } from './demo-jobs-queue.service';
import { ProcessingJobsRepository } from './processing-jobs.repository';

@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly processingJobs: ProcessingJobsRepository,
    private readonly queue: DemoJobsQueueService,
  ) {}

  async dispatchOnce(
    batchSize: number = DEFAULT_OUTBOX_BATCH_SIZE,
  ): Promise<number> {
    this.assertBatchSize(batchSize);
    return this.runInTransaction('dispatch', async (manager) => {
      const outboxRows = await manager
        .getRepository(JobOutboxEntity)
        .createQueryBuilder('outbox')
        .where('outbox.dispatched_at IS NULL')
        .orderBy('outbox.created_at', 'ASC')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .take(batchSize)
        .getMany();

      for (const outbox of outboxRows) {
        this.assertSupportedOutbox(outbox);
        await this.queue.publish(
          outbox.id,
          { processingJobId: outbox.processingJobId },
          outbox.eventName as
            | typeof DEMO_JOB_EVENT_NAME
            | typeof CONVERSION_JOB_EVENT_NAME,
        );

        await this.markProcessingJobDispatched(
          outbox.processingJobId,
          manager,
        );
        const updateResult = await manager
          .getRepository(JobOutboxEntity)
          .update(
            { dispatchedAt: IsNull(), id: outbox.id },
            { dispatchedAt: new Date() },
          );
        if (updateResult.affected !== 1) {
          throw new Error(
            `Job Outbox ${outbox.id} could not be marked as dispatched`,
          );
        }
      }

      return outboxRows.length;
    });
  }

  async reconcileOnce(
    batchSize: number = DEFAULT_OUTBOX_BATCH_SIZE,
  ): Promise<number> {
    this.assertBatchSize(batchSize);
    return this.runInTransaction('reconciliation', async (manager) => {
      const outboxRows = await manager
        .getRepository(JobOutboxEntity)
        .createQueryBuilder('outbox')
        .innerJoin(
          ProcessingJobEntity,
          'processingJob',
          'processingJob.id = outbox.processing_job_id',
        )
        .where('outbox.dispatched_at IS NOT NULL')
        .andWhere('processingJob.status IN (:...statuses)', {
          statuses: [
            ProcessingJobStatus.Dispatched,
            ProcessingJobStatus.Running,
          ],
        })
        .orderBy('outbox.last_reconciled_at', 'ASC', 'NULLS FIRST')
        .addOrderBy('outbox.created_at', 'ASC')
        .addOrderBy('outbox.id', 'ASC')
        .setLock('pessimistic_write', undefined, ['outbox'])
        .setOnLocked('skip_locked')
        .limit(batchSize)
        .getMany();

      for (const outbox of outboxRows) {
        this.assertSupportedOutbox(outbox);
        await this.queue.publish(
          outbox.id,
          { processingJobId: outbox.processingJobId },
          outbox.eventName as
            | typeof DEMO_JOB_EVENT_NAME
            | typeof CONVERSION_JOB_EVENT_NAME,
        );
        const updateResult = await manager
          .getRepository(JobOutboxEntity)
          .update(
            { id: outbox.id },
            { lastReconciledAt: new Date() },
          );
        if (updateResult.affected !== 1) {
          throw new Error(
            `Job Outbox ${outbox.id} could not record reconciliation`,
          );
        }
      }

      return outboxRows.length;
    });
  }

  private assertSupportedOutbox(outbox: JobOutboxEntity): void {
    if (
      outbox.queueName !== DEMO_JOBS_QUEUE_NAME ||
      (outbox.eventName !== DEMO_JOB_EVENT_NAME &&
        outbox.eventName !== CONVERSION_JOB_EVENT_NAME)
    ) {
      throw new Error(
        `Job Outbox ${outbox.id} targets unsupported queue event ${outbox.queueName}/${outbox.eventName}`,
      );
    }
    if (outbox.payload.processingJobId !== outbox.processingJobId) {
      throw new Error(
        `Job Outbox ${outbox.id} has an inconsistent Processing Job identifier`,
      );
    }
  }

  private async markProcessingJobDispatched(
    processingJobId: string,
    manager: EntityManager,
  ): Promise<void> {
    const transitioned = await this.processingJobs.markDispatched(
      processingJobId,
      manager,
    );
    if (transitioned) {
      return;
    }

    const job = await this.processingJobs.findById(processingJobId, manager);
    if (job === null) {
      throw new Error(
        `Processing Job ${processingJobId} referenced by the outbox does not exist`,
      );
    }
    if (job.status === ProcessingJobStatus.Pending) {
      throw new Error(
        `Processing Job ${processingJobId} remained pending after guarded dispatch`,
      );
    }
  }

  private assertBatchSize(batchSize: number): void {
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new RangeError(
        'Outbox dispatcher batch size must be a positive integer',
      );
    }
  }

  private async runInTransaction(
    operation: string,
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
            `Job Outbox ${operation} rollback failed: ${errorMessage(rollbackError)}`,
            errorStack(rollbackError),
          );
        }
      }
      this.logger.error(
        `Job Outbox ${operation} failed: ${errorMessage(error)}`,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
