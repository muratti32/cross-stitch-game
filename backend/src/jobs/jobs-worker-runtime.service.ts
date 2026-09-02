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
import { AccountDeletionFinalizerService } from '../deletion/account-deletion-finalizer.service';
import { AppConfigService } from '../config/app-config.service';
import { WebhookDeliveryArchiveService } from '../webhooks';
import { EventsPartitionService } from '../events';
import { ReconciliationService } from '../reconciliation';
import { OperationalAlertsService } from '../observability';

@Injectable()
export class JobsWorkerRuntimeService implements OnApplicationShutdown {
  private readonly logger = new Logger(JobsWorkerRuntimeService.name);
  private dispatchTimer: NodeJS.Timeout | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private aiArtworkReconcileTimer: NodeJS.Timeout | null = null;
  private accountDeletionFinalizerTimer: NodeJS.Timeout | null = null;
  private webhookArchivePurgeTimer: NodeJS.Timeout | null = null;
  private gameplayEventsMaintenanceTimer: NodeJS.Timeout | null = null;
  private reconciliationTimer: NodeJS.Timeout | null = null;
  private operationalAlertsTimer: NodeJS.Timeout | null = null;
  private activeDispatch: Promise<void> | null = null;
  private running = false;

  constructor(
    private readonly queue: DemoJobsQueueService,
    private readonly consumer: DemoJobConsumerService,
    private readonly dispatcher: OutboxDispatcherService,
    private readonly reconciler: StorageReconcilerService,
    @Inject(forwardRef(() => AiArtworkService))
    private readonly aiArtworks: AiArtworkService,
    private readonly accountDeletionFinalizer: AccountDeletionFinalizerService,
    private readonly config: AppConfigService,
    private readonly webhookArchives: WebhookDeliveryArchiveService,
    private readonly gameplayEvents: EventsPartitionService,
    @Inject(forwardRef(() => ReconciliationService))
    private readonly reconciliation: ReconciliationService,
    private readonly operationalAlerts: OperationalAlertsService,
  ) {}

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    await this.queue.waitUntilReady();
    await this.consumer.start();
    this.running = true;
    this.scheduleDispatch(0);

    // Bounded sweep: each pass verifies at most STORAGE_RECONCILER_BATCH_SIZE
    // objects and the service itself refuses to run overlapping passes.
    this.reconcileTimer = setInterval(() => {
      void this.reconcileStorage();
    }, this.config.storageReconcilerIntervalSeconds * 1000);
    void this.reconcileStorage();

    this.accountDeletionFinalizerTimer = setInterval(() => {
      this.accountDeletionFinalizer.finalizeDueRequests().catch((error: unknown) => {
        this.logger.error(
          `Error running account deletion finalizer: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, 60000);

    this.webhookArchivePurgeTimer = setInterval(() => {
      void this.purgeWebhookArchives();
    }, this.config.webhookArchivePurgeIntervalSeconds * 1000);
    void this.purgeWebhookArchives();

    this.gameplayEventsMaintenanceTimer = setInterval(() => {
      void this.maintainGameplayEventPartitions();
    }, this.config.gameplayEventPartitionMaintenanceIntervalSeconds * 1000);
    void this.maintainGameplayEventPartitions();

    this.reconciliationTimer = setInterval(() => {
      void this.runReconciliation();
    }, this.config.reconciliationIntervalSeconds * 1000);
    void this.runReconciliation();

    this.operationalAlertsTimer = setInterval(() => {
      // OperationalAlertsService.runOnce never throws (logs and swallows
      // internally), matching every other timer here.
      void this.operationalAlerts.runOnce();
    }, this.config.operationalAlertsEvaluationIntervalSeconds * 1000);
    void this.operationalAlerts.runOnce();

    // Safety net only: fal.ai's webhook is the primary delivery path, so this
    // poll runs on a configured cadence rather than every few seconds (#223).
    void this.reconcileAiArtworks();
    this.aiArtworkReconcileTimer = setInterval(() => {
      void this.reconcileAiArtworks();
    }, this.config.aiArtworkReconcileIntervalSeconds * 1000);

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
    if (this.accountDeletionFinalizerTimer !== null) {
      clearInterval(this.accountDeletionFinalizerTimer);
      this.accountDeletionFinalizerTimer = null;
    }
    if (this.webhookArchivePurgeTimer !== null) {
      clearInterval(this.webhookArchivePurgeTimer);
      this.webhookArchivePurgeTimer = null;
    }
    if (this.gameplayEventsMaintenanceTimer !== null) {
      clearInterval(this.gameplayEventsMaintenanceTimer);
      this.gameplayEventsMaintenanceTimer = null;
    }
    if (this.reconciliationTimer !== null) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
    if (this.operationalAlertsTimer !== null) {
      clearInterval(this.operationalAlertsTimer);
      this.operationalAlertsTimer = null;
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

  private async reconcileStorage(): Promise<void> {
    try {
      await this.reconciler.reconcileOnce();
    } catch (error: unknown) {
      this.logger.error(
        `Error running storage reconciler: ${errorMessage(error)}`,
        errorStack(error),
      );
    }
  }

  private async purgeWebhookArchives(): Promise<void> {
    try {
      const before = new Date(
        Date.now() - this.config.webhookArchiveRetentionSeconds * 1000,
      );
      const deleted = await this.webhookArchives.purgeBefore(before);
      if (deleted > 0) {
        this.logger.log(`Purged ${deleted} expired webhook delivery archives`);
      }
    } catch (error: unknown) {
      this.logger.error(
        `Error purging webhook delivery archives: ${errorMessage(error)}`,
        errorStack(error),
      );
    }
  }

  private async maintainGameplayEventPartitions(): Promise<void> {
    try {
      const { droppedPartitions } = await this.gameplayEvents.maintain();
      if (droppedPartitions > 0) {
        this.logger.log(`Dropped ${droppedPartitions} expired gameplay event partitions`);
      }
    } catch (error: unknown) {
      this.logger.error(
        `Error maintaining gameplay event partitions: ${errorMessage(error)}`,
        errorStack(error),
      );
    }
  }

  private async runReconciliation(): Promise<void> {
    try {
      const result = await this.reconciliation.reconcileOnce();
      this.logger.log(`Recorded reconciliation run ${result.runId}`);
    } catch (error: unknown) {
      this.logger.error(
        `Error running reconciliation: ${errorMessage(error)}`,
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
