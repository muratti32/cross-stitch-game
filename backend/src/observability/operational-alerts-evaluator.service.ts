import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThanOrEqual, Repository } from 'typeorm';

import { AppConfigService } from '../config/app-config.service';
import { JobOutboxEntity, ProcessingJobEntity, ProcessingJobStatus } from '../jobs/entities';
import { JobStateTransitionService } from '../jobs/job-state-transition.service';
import { PromotionTransferPackageEntity } from '../promotion/entities';
import { WebhookDeliveryArchiveEntity } from '../webhooks/webhook-delivery-archive.entity';
import type {
  OperationalAlertsEvaluation,
  OperationalAlertSignalResult,
} from './operational-alerts.types';

const FAILED_WEBHOOK_OUTCOMES = ['verification_failed', 'failed'] as const;

/**
 * Evaluates the four ADR-0035/#63 operational signals in one pass. Read-only:
 * queries existing job, webhook archive, and promotion tables directly rather
 * than through their domain services, so this never touches job/promotion
 * behaviour (constraint from #63) and stays usable from both the API and
 * worker deployables without pulling their full feature modules along.
 */
@Injectable()
export class OperationalAlertsEvaluatorService {
  constructor(
    @InjectRepository(ProcessingJobEntity)
    private readonly processingJobs: Repository<ProcessingJobEntity>,
    @InjectRepository(JobOutboxEntity)
    private readonly jobOutbox: Repository<JobOutboxEntity>,
    @InjectRepository(WebhookDeliveryArchiveEntity)
    private readonly webhookDeliveries: Repository<WebhookDeliveryArchiveEntity>,
    @InjectRepository(PromotionTransferPackageEntity)
    private readonly transferPackages: Repository<PromotionTransferPackageEntity>,
    private readonly stateTransitions: JobStateTransitionService,
    private readonly config: AppConfigService,
  ) {}

  async evaluateAll(now: Date = new Date()): Promise<OperationalAlertsEvaluation> {
    const [queueDepth, webhookFailures, stuckJobs, promotionNeedsAttention] =
      await Promise.all([
        this.evaluateQueueDepth(),
        this.evaluateWebhookFailures(now),
        this.evaluateStuckJobs(now),
        this.evaluatePromotionNeedsAttention(),
      ]);
    return { evaluatedAt: now, promotionNeedsAttention, queueDepth, stuckJobs, webhookFailures };
  }

  // Queue depth accumulates in the Job Outbox, not on the BullMQ queue itself:
  // a Processing Job is durably queued the moment its outbox row is written,
  // and stays backlogged until the dispatcher marks it dispatched. That
  // undispatched-row count is the real depth of the durable queue.
  private async evaluateQueueDepth(): Promise<OperationalAlertSignalResult> {
    const value = await this.jobOutbox.count({ where: { dispatchedAt: IsNull() } });
    const threshold = this.config.operationalAlertsQueueDepthThreshold;
    return { breached: value > threshold, signal: 'queue_depth', threshold, value };
  }

  private async evaluateWebhookFailures(now: Date): Promise<OperationalAlertSignalResult> {
    const windowStart = new Date(
      now.getTime() - this.config.operationalAlertsWebhookFailureWindowSeconds * 1000,
    );
    const value = await this.webhookDeliveries.count({
      where: {
        processingOutcome: In([...FAILED_WEBHOOK_OUTCOMES]),
        receivedAt: MoreThanOrEqual(windowStart),
      },
    });
    const threshold = this.config.operationalAlertsWebhookFailureThreshold;
    return { breached: value > threshold, signal: 'webhook_failures', threshold, value };
  }

  private async evaluateStuckJobs(now: Date): Promise<OperationalAlertSignalResult> {
    const cutoff = new Date(
      now.getTime() - this.config.operationalAlertsStuckJobStalenessSeconds * 1000,
    );
    const nonTerminalStatuses = Object.values(ProcessingJobStatus).filter(
      (status) => !this.stateTransitions.isTerminal(status),
    );
    const value = await this.processingJobs.count({
      where: { status: In(nonTerminalStatuses), updatedAt: LessThan(cutoff) },
    });
    const threshold = this.config.operationalAlertsStuckJobThreshold;
    return { breached: value > threshold, signal: 'stuck_jobs', threshold, value };
  }

  private async evaluatePromotionNeedsAttention(): Promise<OperationalAlertSignalResult> {
    const value = await this.transferPackages.count({ where: { status: 'needs_attention' } });
    const threshold = this.config.operationalAlertsPromotionNeedsAttentionThreshold;
    return { breached: value > threshold, signal: 'promotion_needs_attention', threshold, value };
  }
}
