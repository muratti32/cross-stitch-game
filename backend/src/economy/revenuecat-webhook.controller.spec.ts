import { UnauthorizedException } from '@nestjs/common';

import { WebhookDeliveryArchiveService } from '../webhooks';
import { RevenueCatWebhookController } from './revenuecat-webhook.controller';
import { RevenueCatWebhookService } from './revenuecat-webhook.service';
import { RevenueCatWebhookVerifierService } from './revenuecat-webhook-verifier.service';

describe('RevenueCatWebhookController', () => {
  it('archives a verification failure before returning the verification error', async () => {
    const verifier = {
      verify: jest.fn(() => {
        throw new UnauthorizedException('Invalid RevenueCat webhook authorization');
      }),
    } as unknown as RevenueCatWebhookVerifierService;
    const service = { handleEvent: jest.fn() } as unknown as RevenueCatWebhookService;
    const archive = { archive: jest.fn().mockResolvedValue(undefined) } as unknown as WebhookDeliveryArchiveService;
    const controller = new RevenueCatWebhookController(verifier, service, archive);
    const body = { event: { id: 'event-1', prompt: 'private prompt' } };

    await expect(controller.handle('bad-token', body)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(archive.archive).toHaveBeenCalledWith(
      expect.objectContaining({
        processingOutcome: 'verification_failed',
        provider: 'revenuecat',
        providerDeliveryId: 'event-1',
        verificationResult: 'failed',
      }),
    );
    expect(service.handleEvent).not.toHaveBeenCalled();
  });
});
