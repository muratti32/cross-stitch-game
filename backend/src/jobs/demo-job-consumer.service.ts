import { Injectable, Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';

import { AppConfigService } from '../config/app-config.service';
import { ProcessingJobStatus } from './entities';
import {
  DEMO_JOB_EVENT_NAME,
  DEMO_JOBS_QUEUE_NAME,
} from './jobs.constants';
import {
  DemoJobPayload,
  DemoJobQueueData,
  DemoJobQueueResult,
  DemoJobResult,
} from './jobs.types';
import { ProcessingJobsRepository } from './processing-jobs.repository';

type DemoJobWorker = Worker<
  DemoJobQueueData,
  DemoJobQueueResult,
  typeof DEMO_JOB_EVENT_NAME
>;

type DemoJobWorkerJob = Job<
  DemoJobQueueData,
  DemoJobQueueResult,
  typeof DEMO_JOB_EVENT_NAME
>;

export class ProcessingJobNotReadyError extends Error {
  constructor(processingJobId: string) {
    super(`Processing Job ${processingJobId} has not been dispatched yet`);
    this.name = ProcessingJobNotReadyError.name;
  }
}

@Injectable()
export class DemoJobConsumerService {
  private readonly logger = new Logger(DemoJobConsumerService.name);
  private readonly redisUrl: string;
  private worker: DemoJobWorker | null = null;

  constructor(
    config: AppConfigService,
    private readonly processingJobs: ProcessingJobsRepository,
  ) {
    this.redisUrl = config.redisUrl;
  }

  async start(): Promise<void> {
    if (this.worker !== null) {
      return;
    }

    const worker = new Worker<
      DemoJobQueueData,
      DemoJobQueueResult,
      typeof DEMO_JOB_EVENT_NAME
    >(
      DEMO_JOBS_QUEUE_NAME,
      (job: DemoJobWorkerJob) => this.processDelivery(job.data),
      {
        concurrency: 4,
        connection: {
          maxRetriesPerRequest: null,
          url: this.redisUrl,
        },
      },
    );

    worker.on('error', (error: Error) => {
      this.logger.error(
        `BullMQ demo worker error: ${error.message}`,
        error.stack,
      );
    });
    worker.on(
      'failed',
      (job: DemoJobWorkerJob | undefined, error: Error) => {
        const queueJobId = job?.id ?? 'unknown';
        this.logger.error(
          `BullMQ demo delivery ${queueJobId} failed: ${error.message}`,
          error.stack,
        );
      },
    );

    this.worker = worker;
    try {
      await worker.waitUntilReady();
    } catch (error: unknown) {
      this.worker = null;
      await worker.close();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const worker = this.worker;
    this.worker = null;

    if (worker !== null) {
      await worker.close();
    }
  }

  async processDelivery(
    data: DemoJobQueueData,
  ): Promise<DemoJobQueueResult> {
    const claim = await this.processingJobs.claimForWorker(
      data.processingJobId,
    );

    if (claim.kind === 'missing') {
      throw new Error(
        `BullMQ delivery references missing Processing Job ${data.processingJobId}`,
      );
    }
    if (claim.kind === 'retry') {
      throw new ProcessingJobNotReadyError(data.processingJobId);
    }
    if (claim.kind === 'terminal') {
      return {
        outcome: 'terminal-replay',
        processingJobId: claim.job.id,
      };
    }

    const resumed = claim.kind === 'resume';
    try {
      const payload = parseDemoPayload(claim.job.payload);
      const result: DemoJobResult = {
        echo: payload.message,
        uppercase: payload.message.toUpperCase(),
      };
      const completed = await this.processingJobs.completeFromRunning(
        claim.job.id,
        result,
      );
      if (completed) {
        return {
          outcome: resumed ? 'resumed-and-completed' : 'completed',
          processingJobId: claim.job.id,
        };
      }

      const currentJob = await this.processingJobs.findById(claim.job.id);
      if (
        currentJob !== null &&
        (currentJob.status === ProcessingJobStatus.Completed ||
          currentJob.status === ProcessingJobStatus.Failed)
      ) {
        return {
          outcome: 'terminal-replay',
          processingJobId: claim.job.id,
        };
      }
      throw new Error(
        `Processing Job ${claim.job.id} lost its running state before completion`,
      );
    } catch (error: unknown) {
      try {
        await this.processingJobs.failFromRunning(
          claim.job.id,
          errorMessage(error),
        );
      } catch (stateError: unknown) {
        this.logger.error(
          `Could not persist failure for Processing Job ${claim.job.id}: ${errorMessage(stateError)}`,
          errorStack(stateError),
        );
      }
      throw asError(error);
    }
  }
}

function parseDemoPayload(payload: DemoJobPayload): DemoJobPayload;
function parseDemoPayload(payload: Record<string, unknown>): DemoJobPayload;
function parseDemoPayload(payload: Record<string, unknown>): DemoJobPayload {
  if (typeof payload.message !== 'string') {
    throw new TypeError('Demo Processing Job payload must contain a message');
  }
  return { message: payload.message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
