import { BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';

import { AiArtworkService } from '../ai-artwork/ai-artwork.service';
import { RewardGrantService } from '../economy/reward-grant.service';
import { RevenueCatWebhookService } from '../economy/revenuecat-webhook.service';
import { WebhookDeliveryArchiveService } from '../webhooks';
import { OperatorAuditLogService } from './operator-audit-log.service';
import { WebhookDeliveriesAdminService } from './webhook-deliveries-admin.service';

const DELIVERY_ID = 'd8f07d6b-5911-4f97-81d3-5ef0162ad48f';
const OPERATOR_ID = '15fc31da-8ad3-46e5-a6ca-7d2b8ab3b8f2';

describe('WebhookDeliveriesAdminService', () => {
  function createService(verificationResult: 'verified' | 'failed' = 'verified') {
    const archives = {
      findById: jest.fn().mockResolvedValue({
        id: DELIVERY_ID,
        payload: { event: { type: 'NON_RENEWING_PURCHASE' } },
        provider: 'revenuecat',
        verificationResult,
      }),
      recordReplay: jest.fn().mockResolvedValue(undefined),
    } as unknown as WebhookDeliveryArchiveService;
    const revenuecat = {
      handleEvent: jest.fn().mockResolvedValue({ duplicate: true }),
    } as unknown as RevenueCatWebhookService;
    const moduleRef = {
      get: jest.fn((token: unknown) => {
        if (token === RevenueCatWebhookService) return revenuecat;
        throw new Error('unexpected replay service');
      }),
    } as unknown as ModuleRef;
    const record = jest.fn().mockResolvedValue(undefined);
    const dataSource = {
      transaction: jest.fn((callback: (manager: object) => Promise<void>) => callback({})),
    } as unknown as DataSource;
    const service = new WebhookDeliveriesAdminService(
      archives,
      moduleRef,
      dataSource,
      { record } as unknown as OperatorAuditLogService,
    );
    return { archives, record, revenuecat, service };
  }

  it('replays through the real provider handler and records a duplicate safely', async () => {
    const { archives, record, revenuecat, service } = createService();

    await expect(service.replay(DELIVERY_ID, OPERATOR_ID, 'request-1')).resolves.toEqual({
      id: DELIVERY_ID,
      outcome: 'duplicate_ignored',
    });
    expect(revenuecat.handleEvent).toHaveBeenCalledWith({
      event: { type: 'NON_RENEWING_PURCHASE' },
    });
    expect(archives.recordReplay).toHaveBeenCalledWith(
      DELIVERY_ID,
      OPERATOR_ID,
      'duplicate_ignored',
      null,
    );
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'webhook_delivery.replay', outcome: 'success' }),
    );
  });

  it('refuses to replay deliveries that did not pass provider verification', async () => {
    const { archives, record, service } = createService('failed');

    await expect(service.replay(DELIVERY_ID, OPERATOR_ID, null)).rejects.toBeInstanceOf(BadRequestException);
    expect(archives.recordReplay).toHaveBeenCalledWith(
      DELIVERY_ID,
      OPERATOR_ID,
      'failed',
      expect.stringContaining('cannot be replayed'),
    );
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: 'failure' }),
    );
  });
});
