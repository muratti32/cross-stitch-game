import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { AiArtworkService } from '../ai-artwork/ai-artwork.service';
import { RewardGrantService } from '../economy/reward-grant.service';
import { RevenueCatWebhookService } from '../economy/revenuecat-webhook.service';
import type { AdMobSsvReward } from '../economy/admob-ssv-verifier.service';
import {
  WebhookDeliveryArchiveEntity,
  WebhookDeliveryArchiveService,
  WebhookProcessingOutcome,
  WebhookProvider,
} from '../webhooks';
import { OperatorAuditLogService } from './operator-audit-log.service';

@Injectable()
export class WebhookDeliveriesAdminService {
  constructor(
    private readonly archives: WebhookDeliveryArchiveService,
    private readonly moduleRef: ModuleRef,
    private readonly dataSource: DataSource,
    private readonly auditLog: OperatorAuditLogService,
  ) {}

  list(filters: {
    provider?: WebhookProvider;
    outcome?: WebhookProcessingOutcome;
  }): Promise<WebhookDeliveryArchiveEntity[]> {
    return this.archives.listRecent(filters);
  }

  async replay(id: string, operatorId: string, requestId: string | null): Promise<{
    id: string;
    outcome: WebhookProcessingOutcome;
  }> {
    const delivery = await this.archives.findById(id);
    if (delivery === null) {
      throw new NotFoundException('Webhook delivery not found');
    }

    let outcome: WebhookProcessingOutcome = 'failed';
    let failureReason: string | null = null;
    try {
      if (delivery.verificationResult !== 'verified') {
        throw new BadRequestException(
          'Verification-failed deliveries cannot be replayed without provider signing material',
        );
      }
      outcome = await this.runVerifiedHandler(delivery);
      await this.archives.recordReplay(id, operatorId, outcome, null);
      await this.recordAudit(operatorId, requestId, id, 'success', outcome, null);
      return { id, outcome };
    } catch (error: unknown) {
      failureReason = messageOf(error);
      await this.archives.recordReplay(id, operatorId, 'failed', failureReason);
      await this.recordAudit(operatorId, requestId, id, 'failure', 'failed', failureReason);
      throw error;
    }
  }

  private async runVerifiedHandler(
    delivery: WebhookDeliveryArchiveEntity,
  ): Promise<WebhookProcessingOutcome> {
    switch (delivery.provider) {
      case 'revenuecat': {
        const service = this.moduleRef.get(RevenueCatWebhookService, { strict: false });
        const result = await service.handleEvent(delivery.payload);
        return result.duplicate ? 'duplicate_ignored' : 'processed';
      }
      case 'admob': {
        const service = this.moduleRef.get(RewardGrantService, { strict: false });
        const result = await service.processVerifiedAdCallback(
          asAdMobReward(delivery.payload),
        );
        return result.replayed ? 'duplicate_ignored' : 'processed';
      }
      case 'fal': {
        const { jobId, requestId } = asFalPayload(delivery.payload);
        const service = this.moduleRef.get(AiArtworkService, { strict: false });
        const duplicate = await service.handleVerifiedWebhook(jobId, requestId);
        return duplicate ? 'duplicate_ignored' : 'processed';
      }
    }
  }

  private async recordAudit(
    operatorId: string,
    requestId: string | null,
    deliveryId: string,
    auditOutcome: 'success' | 'failure',
    replayOutcome: WebhookProcessingOutcome,
    failureReason: string | null,
  ): Promise<void> {
    await this.dataSource.transaction((manager) =>
      this.auditLog.record(manager, {
        action: 'webhook_delivery.replay',
        after: { failureReason, replayOutcome },
        operatorAccountId: operatorId,
        outcome: auditOutcome,
        requestId,
        targetId: deliveryId,
        targetType: 'webhook_delivery',
      }),
    );
  }
}

function asAdMobReward(payload: Record<string, unknown>): AdMobSsvReward {
  return {
    adNetwork: requiredString(payload, 'adNetwork'),
    adUnit: requiredString(payload, 'adUnit'),
    customData: requiredString(payload, 'customData'),
    rewardAmount: requiredString(payload, 'rewardAmount'),
    rewardItem: requiredString(payload, 'rewardItem'),
    timestamp: requiredString(payload, 'timestamp'),
    transactionId: requiredString(payload, 'transactionId'),
    userId: requiredString(payload, 'userId'),
  };
}

function asFalPayload(payload: Record<string, unknown>): {
  jobId: string;
  requestId: string;
} {
  const body = payload.body;
  if (body === null || typeof body !== 'object') {
    throw new BadRequestException('Stored fal.ai delivery has no request body');
  }
  return {
    jobId: requiredString(payload, 'jobId'),
    requestId: requiredString(body as Record<string, unknown>, 'request_id'),
  };
}

function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException(`Stored webhook delivery is missing ${key}`);
  }
  return value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Webhook replay failed';
}
