import { Repository } from 'typeorm';

import { WebhookDeliveryArchiveEntity } from './webhook-delivery-archive.entity';
import { WebhookDeliveryArchiveService } from './webhook-delivery-archive.service';

describe('WebhookDeliveryArchiveService', () => {
  function createService(options: { save?: jest.Mock } = {}) {
    const save = options.save ?? jest.fn().mockResolvedValue({});
    const repository = {
      create: jest.fn((value: unknown) => value),
      createQueryBuilder: jest.fn(),
      save,
    } as unknown as Repository<WebhookDeliveryArchiveEntity>;
    return { repository, save, service: new WebhookDeliveryArchiveService(repository) };
  }

  it('scrubs sensitive values recursively before persistence', async () => {
    const { repository, service } = createService();

    await service.archive({
      payload: {
        nested: {
          email: 'player@example.test',
          prompt: 'a private embroidered fox',
          provider_id: 'provider-user-id',
            values: [
              { authorization: 'Bearer secret' },
              { otp: '123456' },
              { signature: 'signed-value' },
              { artworkBytes: Buffer.from('image-bytes') },
            ],
        },
        transaction_id: 'transaction-1',
      },
      processingOutcome: 'processed',
      provider: 'revenuecat',
      providerDeliveryId: 'event-1',
      verificationResult: 'verified',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          nested: {
            email: '[Scrubbed]',
            prompt: '[Scrubbed]',
            provider_id: '[Scrubbed]',
            values: [
              { authorization: '[Scrubbed]' },
              { otp: '[Scrubbed]' },
              { signature: '[Scrubbed]' },
              { artworkBytes: '[Scrubbed]' },
            ],
          },
          transaction_id: 'transaction-1',
        },
      }),
    );
  });

  it('does not let an archive write failure escape the request path', async () => {
    const { service } = createService({ save: jest.fn().mockRejectedValue(new Error('database unavailable')) });

    await expect(
      service.archive({
        payload: {},
        processingOutcome: 'verification_failed',
        provider: 'admob',
        verificationResult: 'failed',
      }),
    ).resolves.toBeUndefined();
  });

  it('purges only rows older than the supplied retention boundary', async () => {
    const execute = jest.fn().mockResolvedValue({ affected: 3 });
    const where = jest.fn().mockReturnValue({ execute });
    const remove = jest.fn().mockReturnValue({ where });
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue({ delete: remove }),
    } as unknown as Repository<WebhookDeliveryArchiveEntity>;
    const service = new WebhookDeliveryArchiveService(repository);
    const before = new Date('2026-07-01T00:00:00.000Z');

    await expect(service.purgeBefore(before)).resolves.toBe(3);
    expect(where).toHaveBeenCalledWith('received_at < :before', { before });
  });
});
