import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';

import { DemoJobConsumerService } from './demo-job-consumer.service';
import { DemoJobsQueueService } from './demo-jobs-queue.service';
import {
  DEFAULT_OUTBOX_POLL_INTERVAL_MS,
  OUTBOX_RETRY_INTERVAL_MS,
} from './jobs.constants';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { StorageReconcilerService } from '../sessions/storage-reconciler.service';
import { AiArtworkService } from '../ai-artwork/ai-artwork.service';

@Injectable()
export class JobsWorkerRuntimeService implements OnApplicationShutdown {
  private readonly logger = new Logger(JobsWorkerRuntimeService.name);
  private dispatchTimer: NodeJS.Timeout | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private aiArtworkReconcileTimer: NodeJS.Timeout | null = null;
  private activeDispatch: Promise<void> | null = null;
  private running = false;

  constructor(
    private readonly queue: DemoJobsQueueService,
    private readonly consumer: DemoJobConsumerService,
    private readonly dispatcher: OutboxDispatcherService,
    private readonly reconciler: StorageReconcilerService,
    @Inject(forwardRef(() => AiArtworkService))
    private readonly aiArtworks: AiArtworkService,
  ) {}

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    await this.queue.waitUntilReady();
    await this.consumer.start();
    this.running = true;
    this.scheduleDispatch(0);

    this.reconcileTimer = setInterval(() => {
      this.reconciler.reconcileOnce().catch((error: unknown) => {
        this.logger.error(
          `Error running storage reconciler: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, 60000);

    void this.reconcileAiArtworks();
    this.aiArtworkReconcileTimer = setInterval(() => {
      void this.reconcileAiArtworks();
    }, 15000);

    this.logger.log('Jobs worker runtime started');
  }

  async stop(): Promise<void> {
    if (!this.running && this.activeDispatch === null) {
      await this.consumer.stop();
      await this.queue.close();
      return;
    }

    this.running = false;
    if (this.dispatchTimer !== null) {
      clearTimeout(this.dispatchTimer);
      this.dispatchTimer = null;
    }
    if (this.reconcileTimer !== null) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (this.aiArtworkReconcileTimer !== null) {
      clearInterval(this.aiArtworkReconcileTimer);
      this.aiArtworkReconcileTimer = null;
    }
    if (this.activeDispatch !== null) {
      await this.activeDispatch;
    }
    await this.consumer.stop();
    await this.queue.close();
    this.logger.log('Jobs worker runtime stopped');
  }

  onApplicationShutdown(): Promise<void> {
    return this.stop();
  }

  private scheduleDispatch(delayMs: number): void {
    if (!this.running) {
      return;
    }
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = null;
      const dispatch = this.runDispatchCycle();
      this.activeDispatch = dispatch;
      void dispatch.finally(() => {
        if (this.activeDispatch === dispatch) {
          this.activeDispatch = null;
        }
      });
    }, delayMs);
  }

  private async runDispatchCycle(): Promise<void> {
    let nextDelay = DEFAULT_OUTBOX_POLL_INTERVAL_MS;
    try {
      const dispatchedCount = await this.dispatcher.dispatchOnce();
      await this.dispatcher.reconcileOnce();
      if (dispatchedCount > 0) {
        nextDelay = 0;
      }
    } catch (error: unknown) {
      nextDelay = OUTBOX_RETRY_INTERVAL_MS;
      this.logger.error(
        `Retrying Job Outbox dispatcher after error: ${errorMessage(error)}`,
        errorStack(error),
      );
    } finally {
      this.scheduleDispatch(nextDelay);
    }
  }

  private async reconcileAiArtworks(): Promise<void> {
    try {
      await this.aiArtworks.reconcilePending();
    } catch (error: unknown) {
      this.logger.error(
        `Error reconciling AI Artworks: ${errorMessage(error)}`,
        errorStack(error),
      );
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
