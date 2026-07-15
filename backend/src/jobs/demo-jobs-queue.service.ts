import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';

import { AppConfigService } from '../config/app-config.service';
import {
  DEMO_JOB_EVENT_NAME,
  DEMO_JOBS_QUEUE_NAME,
} from './jobs.constants';
import {
  DemoJobQueueData,
  ProcessingJobEventName,
  ProcessingJobQueueResult,
} from './jobs.types';

export type DemoBullJob = Job<
  DemoJobQueueData,
  ProcessingJobQueueResult,
  ProcessingJobEventName
>;

export type DemoBullQueue = Queue<
  DemoJobQueueData,
  ProcessingJobQueueResult,
  ProcessingJobEventName,
  DemoJobQueueData,
  ProcessingJobQueueResult,
  ProcessingJobEventName
>;

@Injectable()
export class DemoJobsQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(DemoJobsQueueService.name);
  private readonly processingQueue: DemoBullQueue;
  private closed = false;

  constructor(config: AppConfigService) {
    this.processingQueue = new Queue<
      DemoJobQueueData,
      ProcessingJobQueueResult,
      ProcessingJobEventName,
      DemoJobQueueData,
      ProcessingJobQueueResult,
      ProcessingJobEventName
    >(DEMO_JOBS_QUEUE_NAME, {
      connection: {
        connectTimeout: 5_000,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        url: config.redisUrl,
      },
      defaultJobOptions: {
        attempts: 5,
        backoff: { delay: 250, type: 'exponential' },
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
    this.processingQueue.on('error', (error: Error) => {
      this.logger.error(
        `BullMQ demo queue error: ${error.message}`,
        error.stack,
      );
    });
  }

  get bullQueue(): DemoBullQueue {
    return this.processingQueue;
  }

  async publish(
    outboxId: string,
    data: DemoJobQueueData,
    eventName: ProcessingJobEventName = DEMO_JOB_EVENT_NAME,
  ): Promise<DemoBullJob> {
    const existingJob = await this.processingQueue.getJob(outboxId);
    if (existingJob === undefined) {
      return this.processingQueue.add(eventName, data, {
        jobId: outboxId,
      });
    }
    if (
      existingJob.data.processingJobId !== data.processingJobId ||
      existingJob.name !== eventName
    ) {
      throw new Error(
        `BullMQ job ${outboxId} references a different Processing Job`,
      );
    }

    const state = await existingJob.getState();

    if (state === 'failed' || state === 'completed') {
      await existingJob.retry(state, {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
    }

    return existingJob;
  }

  addDuplicate(outboxId: string, data: DemoJobQueueData): Promise<DemoBullJob> {
    return this.publish(outboxId, data);
  }

  getJob(outboxId: string): Promise<DemoBullJob | undefined> {
    return this.processingQueue.getJob(outboxId);
  }

  async waitUntilReady(): Promise<void> {
    await this.processingQueue.waitUntilReady();
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.processingQueue.close();
  }

  onModuleDestroy(): Promise<void> {
    return this.close();
  }
}
