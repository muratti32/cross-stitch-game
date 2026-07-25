import { ObjectLiteral, Repository } from 'typeorm';

import { AppConfigService } from '../config/app-config.service';
import { JobOutboxEntity, ProcessingJobEntity } from '../jobs/entities';
import { JobStateTransitionService } from '../jobs/job-state-transition.service';
import { PromotionTransferPackageEntity } from '../promotion/entities';
import { WebhookDeliveryArchiveEntity } from '../webhooks/webhook-delivery-archive.entity';
import { OperationalAlertsEvaluatorService } from './operational-alerts-evaluator.service';

const THRESHOLD = 5;

function buildEvaluator(counts: {
  outbox?: number;
  promotion?: number;
  processingJobs?: number;
  webhookFailures?: number;
}) {
  const repo = <T extends ObjectLiteral>(value: number) =>
    ({ count: jest.fn().mockResolvedValue(value) }) as unknown as Repository<T>;
  const config = {
    operationalAlertsPromotionNeedsAttentionThreshold: THRESHOLD,
    operationalAlertsQueueDepthThreshold: THRESHOLD,
    operationalAlertsStuckJobStalenessSeconds: 1800,
    operationalAlertsStuckJobThreshold: THRESHOLD,
    operationalAlertsWebhookFailureThreshold: THRESHOLD,
    operationalAlertsWebhookFailureWindowSeconds: 3600,
  } as AppConfigService;

  return new OperationalAlertsEvaluatorService(
    repo<ProcessingJobEntity>(counts.processingJobs ?? 0),
    repo<JobOutboxEntity>(counts.outbox ?? 0),
    repo<WebhookDeliveryArchiveEntity>(counts.webhookFailures ?? 0),
    repo<PromotionTransferPackageEntity>(counts.promotion ?? 0),
    new JobStateTransitionService(),
    config,
  );
}

describe('OperationalAlertsEvaluatorService', () => {
  const now = new Date('2026-07-25T12:00:00.000Z');

  it('breaches each signal above its threshold', async () => {
    const evaluation = await buildEvaluator({
      outbox: THRESHOLD + 1,
      processingJobs: THRESHOLD + 1,
      promotion: THRESHOLD + 1,
      webhookFailures: THRESHOLD + 1,
    }).evaluateAll(now);

    expect(evaluation.queueDepth).toEqual({
      breached: true, signal: 'queue_depth', threshold: THRESHOLD, value: THRESHOLD + 1,
    });
    expect(evaluation.webhookFailures.breached).toBe(true);
    expect(evaluation.stuckJobs.breached).toBe(true);
    expect(evaluation.promotionNeedsAttention.breached).toBe(true);
  });

  it('does not breach a signal sitting exactly at its threshold', async () => {
    const evaluation = await buildEvaluator({
      outbox: THRESHOLD,
      processingJobs: THRESHOLD,
      promotion: THRESHOLD,
      webhookFailures: THRESHOLD,
    }).evaluateAll(now);

    expect(evaluation.queueDepth.breached).toBe(false);
    expect(evaluation.webhookFailures.breached).toBe(false);
    expect(evaluation.stuckJobs.breached).toBe(false);
    expect(evaluation.promotionNeedsAttention.breached).toBe(false);
  });

  it('does not breach a signal below its threshold', async () => {
    const evaluation = await buildEvaluator({}).evaluateAll(now);

    expect(evaluation.evaluatedAt).toEqual(now);
    for (const result of [
      evaluation.queueDepth,
      evaluation.webhookFailures,
      evaluation.stuckJobs,
      evaluation.promotionNeedsAttention,
    ]) {
      expect(result).toEqual(
        expect.objectContaining({ breached: false, threshold: THRESHOLD, value: 0 }),
      );
    }
  });
});
