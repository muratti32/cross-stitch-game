import { DataSource, EntityManager, Repository } from 'typeorm';

import { AppConfigService } from '../config/app-config.service';
import { StorageReconcilerService } from '../sessions/storage-reconciler.service';
import { ReconciliationFindingEntity, ReconciliationRunEntity } from './entities';
import { ReconciliationService } from './reconciliation.service';

function buildService(params?: {
  archiveRows?: readonly { payload: Record<string, unknown> }[];
  ledgerRows?: readonly { source_key: string }[];
  reservationRows?: readonly { id: string; processing_job_id: string; job_status: string | null }[];
  storage?: {
    registryMissingObjectKeys: readonly string[];
    storageOrphanObjectKeys: readonly string[];
  };
}) {
  const savedFindings: ReconciliationFindingEntity[] = [];
  const runRepository = {
    create: jest.fn((input: Partial<ReconciliationRunEntity>) => input),
    save: jest.fn(async (input: Partial<ReconciliationRunEntity>) => ({
      ...input,
      id: '11111111-1111-4111-8111-111111111111',
      ranAt: new Date('2026-07-25T12:00:00.000Z'),
    } as ReconciliationRunEntity)),
  } as unknown as Repository<ReconciliationRunEntity>;
  const findingRepository = {
    create: jest.fn((input: Partial<ReconciliationFindingEntity>) => input),
    save: jest.fn(async (input: ReconciliationFindingEntity[]) => {
      savedFindings.push(...input);
      return input;
    }),
  } as unknown as Repository<ReconciliationFindingEntity>;
  const manager = {
    getRepository: (entity: typeof ReconciliationRunEntity | typeof ReconciliationFindingEntity) =>
      entity === ReconciliationRunEntity ? runRepository : findingRepository,
  } as unknown as EntityManager;
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('webhook_delivery_archives')) return params?.archiveRows ?? [];
    if (sql.includes('coin_ledger_entries')) return params?.ledgerRows ?? [];
    if (sql.includes('ai_credit_reservations')) return params?.reservationRows ?? [];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const dataSource = {
    query,
    transaction: async <T>(work: (transactionManager: EntityManager) => Promise<T>) => work(manager),
  } as unknown as DataSource;
  const storage = {
    reportDiscrepancies: jest.fn().mockResolvedValue(params?.storage ?? {
      registryMissingObjectKeys: [], storageOrphanObjectKeys: [],
    }),
  } as unknown as StorageReconcilerService;
  const config = {
    aiCreditReservationStalenessSeconds: 1800,
    webhookArchiveRetentionSeconds: 30 * 24 * 60 * 60,
  } as AppConfigService;
  return {
    query,
    savedFindings,
    service: new ReconciliationService(dataSource, storage, config, runRepository, findingRepository),
  };
}

describe('ReconciliationService', () => {
  it('records each discrepancy class while excluding healthy provider, storage, and reservation records', async () => {
    const { savedFindings, service } = buildService({
      archiveRows: [
        { payload: commercePayload('delivery-only', 'coin_pack_300') },
        { payload: commercePayload('healthy', 'coin_pack_300') },
        { payload: commercePayload('unknown-product', 'unowned_product') },
      ],
      ledgerRows: [
        { source_key: 'commerce:production:healthy' },
        { source_key: 'commerce:sandbox:ledger-only' },
      ],
      reservationRows: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          job_status: 'completed',
          processing_job_id: '33333333-3333-4333-8333-333333333333',
        },
      ],
      storage: {
        registryMissingObjectKeys: ['patterns/missing.bin'],
        storageOrphanObjectKeys: ['patterns/orphan.bin'],
      },
    });

    await service.reconcileOnce(new Date('2026-07-25T12:00:00.000Z'));

    expect(savedFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ findingClass: 'commerce_delivery_without_ledger', identifier: 'delivery-only' }),
      expect.objectContaining({ findingClass: 'commerce_ledger_without_delivery', identifier: 'ledger-only' }),
      expect.objectContaining({ findingClass: 'storage_registry_missing_object', identifier: 'patterns/missing.bin' }),
      expect.objectContaining({ findingClass: 'storage_orphan_object', identifier: 'patterns/orphan.bin' }),
      expect.objectContaining({
        detail: 'completed',
        findingClass: 'ai_credit_reservation_stuck',
        identifier: '22222222-2222-4222-8222-222222222222',
        relatedIdentifier: '33333333-3333-4333-8333-333333333333',
      }),
    ]));
    expect(savedFindings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ identifier: 'healthy' }),
      expect.objectContaining({ identifier: 'unknown-product' }),
    ]));
  });

  it('skips an archived delivery whose identifier the scrubber redacted', async () => {
    const { savedFindings, service } = buildService({
      archiveRows: [{ payload: commercePayload('[Scrubbed]', 'coin_pack_300') }],
    });

    await service.reconcileOnce(new Date('2026-07-25T12:00:00.000Z'));

    expect(savedFindings).toEqual([]);
  });

  it('limits both commerce directions to the webhook archive retention window', async () => {
    const { query, service } = buildService();
    const now = new Date('2026-07-25T12:00:00.000Z');
    const expectedWindowStart = new Date('2026-06-25T12:00:00.000Z');

    await service.reconcileOnce(now);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('received_at >= $1'),
      [expectedWindowStart],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('created_at >= $1'),
      [expectedWindowStart],
    );
  });

  it('does not report a reservation outside the reserved-and-stale query', async () => {
    const { query, savedFindings, service } = buildService();
    const now = new Date('2026-07-25T12:00:00.000Z');

    await service.reconcileOnce(now);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("reservation.status = 'reserved'"),
      [new Date('2026-07-25T11:30:00.000Z')],
    );
    expect(savedFindings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ findingClass: 'ai_credit_reservation_stuck' }),
    ]));
  });
});

function commercePayload(transactionId: string, productId: string): Record<string, unknown> {
  return {
    event: {
      environment: 'PRODUCTION',
      product_id: productId,
      transaction_id: transactionId,
      type: 'NON_RENEWING_PURCHASE',
    },
  };
}
