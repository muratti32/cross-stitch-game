import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Job, Worker } from 'bullmq';

import { OfficialPatternDraftJobConsumerService } from '../admin/official-pattern-draft-job-consumer.service';
import { AppConfigService } from '../config/app-config.service';
import { ConversionJobConsumerService } from '../conversion/conversion-job-consumer.service';
import { AiArtworkJobConsumerService } from '../ai-artwork/ai-artwork-job-consumer.service';
import { CatalogPrecheckJobConsumerService } from '../catalog/catalog-precheck-job-consumer.service';
import { ProcessingJobStatus } from './entities';
import {
  CONVERSION_JOB_EVENT_NAME,
  DEMO_JOBS_QUEUE_NAME,
  OFFICIAL_PATTERN_DRAFT_EVENT_NAME,
  AI_ARTWORK_JOB_EVENT_NAME,
  CATALOG_PRECHECK_EVENT_NAME,
} from './jobs.constants';
import {
  DemoJobPayload,
  DemoJobQueueData,
  ProcessingJobEventName,
  ProcessingJobQueueResult,
  DemoJobResult,
} from './jobs.types';
import { ProcessingJobsRepository } from './processing-jobs.repository';
import { captureWorkerFailure } from '../observability';

type DemoJobWorker = Worker<
  DemoJobQueueData,
  ProcessingJobQueueResult,
  ProcessingJobEventName
>;

type DemoJobWorkerJob = Job<
  DemoJobQueueData,
  ProcessingJobQueueResult,
  ProcessingJobEventName
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
  private readonly workerConcurrency: number;
  private worker: DemoJobWorker | null = null;

  constructor(
    config: AppConfigService,
    @Inject(forwardRef(() => ConversionJobConsumerService))
    private readonly conversionJobs: ConversionJobConsumerService,
    @Inject(forwardRef(() => OfficialPatternDraftJobConsumerService))
    private readonly officialPatternDraftJobs: OfficialPatternDraftJobConsumerService,
    private readonly aiArtworkJobs: AiArtworkJobConsumerService,
    @Inject(forwardRef(() => CatalogPrecheckJobConsumerService))
    private readonly catalogPrecheckJobs: CatalogPrecheckJobConsumerService,
    private readonly processingJobs: ProcessingJobsRepository,
  ) {
    this.redisUrl = config.redisUrl;
    this.workerConcurrency = config.conversionWorkerConcurrency;
  }

  async start(): Promise<void> {
    if (this.worker !== null) {
      return;
    }

    const worker = new Worker<
      DemoJobQueueData,
      ProcessingJobQueueResult,
      ProcessingJobEventName
    >(
      DEMO_JOBS_QUEUE_NAME,
      (job: DemoJobWorkerJob) => this.processQueueDelivery(job),
      {
        concurrency: this.workerConcurrency,
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
        if (job !== undefined && job.attemptsMade >= (job.opts.attempts ?? 1)) {
          if (job.name === CONVERSION_JOB_EVENT_NAME) {
            void this.conversionJobs
              .failExhausted(job.data.processingJobId, error.message)
              .catch((cleanupError: unknown) => {
                this.logger.error(
                  `Could not finalize exhausted Pattern Conversion ${job.data.processingJobId}: ${errorMessage(cleanupError)}`,
                  errorStack(cleanupError),
                );
              });
          } else if (job.name === OFFICIAL_PATTERN_DRAFT_EVENT_NAME) {
            void this.officialPatternDraftJobs
              .failExhausted(job.data.processingJobId, error.message)
              .catch((cleanupError: unknown) => {
                this.logger.error(
                  `Could not finalize exhausted Official Pattern Draft ${job.data.processingJobId}: ${errorMessage(cleanupError)}`,
                  errorStack(cleanupError),
                );
              });
          } else if (job.name === AI_ARTWORK_JOB_EVENT_NAME) {
            void this.aiArtworkJobs.failExhausted(job.data.processingJobId, error.message);
          } else if (job.name === CATALOG_PRECHECK_EVENT_NAME) {
            void this.catalogPrecheckJobs.failExhausted(job.data.processingJobId, error.message);
          }
        }
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
  ): Promise<ProcessingJobQueueResult> {
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

  private async processQueueDelivery(
    job: DemoJobWorkerJob,
  ): Promise<ProcessingJobQueueResult> {
    try {
      if (job.name === CONVERSION_JOB_EVENT_NAME) {
        return await this.conversionJobs.processDelivery(job.data.processingJobId);
      }
      if (job.name === OFFICIAL_PATTERN_DRAFT_EVENT_NAME) {
        return await this.officialPatternDraftJobs.processDelivery(job.data.processingJobId);
      }
      if (job.name === AI_ARTWORK_JOB_EVENT_NAME) {
        return await this.aiArtworkJobs.processDelivery(job.data.processingJobId);
      }
      if (job.name === CATALOG_PRECHECK_EVENT_NAME) {
        return await this.catalogPrecheckJobs.processDelivery(job.data.processingJobId);
      }
      return await this.processDelivery(job.data);
    } catch (error: unknown) {
      if (!(error instanceof ProcessingJobNotReadyError)) {
        captureWorkerFailure(error, job.name);
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
