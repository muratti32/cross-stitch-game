import { BadRequestException } from '@nestjs/common';

import { PatternEntity } from '../catalog/entities';
import { AdminCatalogService } from './admin-catalog.service';

function pattern(overrides: Partial<PatternEntity> = {}): PatternEntity {
  return Object.assign(new PatternEntity(), {
    artifactByteLength: 10,
    artifactChecksum: 'a'.repeat(64),
    artifactObjectKey: 'patterns/id/artifact.pb.gz',
    artifactSchemaVersion: 1,
    categoryCode: 'animals',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    creatorName: 'Stitch Wish',
    creatorProfileId: null,
    height: 10,
    id: '00000000-0000-4000-8000-000000000001',
    likeCount: 0,
    ownerAccountId: null,
    paletteSize: 2,
    previewObjectKey: 'patterns/id/preview.webp',
    publishedAt: new Date('2026-08-02T00:00:00.000Z'),
    status: 'available',
    tags: [],
    thumbnailRendererVersion: 1,
    title: 'Fox',
    unlockPriceTier: null,
    visibility: 'catalog',
    width: 10,
    ...overrides,
  });
}

function serviceWithTransactionPattern(value: PatternEntity) {
  const save = jest.fn((entity: PatternEntity) => Promise.resolve(entity));
  const findOne = jest.fn(() => Promise.resolve(value));
  const manager = {
    getRepository: jest.fn(() => ({ findOne, save })),
  };
  const dataSource = {
    transaction: jest.fn((callback: (transactionManager: typeof manager) => unknown) =>
      Promise.resolve(callback(manager)),
    ),
  };
  const auditLog = { record: jest.fn() };
  const service = new AdminCatalogService(
    dataSource as never,
    { publicUrl: (key: string) => `https://cdn.test/${key}` } as never,
    auditLog,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { auditLog, save, service };
}

describe('AdminCatalogService Pattern contract', () => {
  it.each([
    [null, 'official'],
    ['00000000-0000-4000-8000-000000000002', 'community'],
  ] as const)('exposes creatorProfileId %s as an explicit %s Pattern type', async (creatorProfileId, patternType) => {
    const entity = pattern({ creatorProfileId });
    const queryBuilder = {
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      createQueryBuilder: jest.fn(),
      getManyAndCount: jest.fn().mockResolvedValue([[entity], 1]),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const patterns = { createQueryBuilder: jest.fn(() => queryBuilder) };
    const service = new AdminCatalogService(
      {} as never,
      { publicUrl: (key: string) => `https://cdn.test/${key}` } as never,
      {} as never,
      patterns as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.listPatterns({ page: 1, pageSize: 20 });

    expect(result.items[0]).toMatchObject({ patternType });
    expect(result.items[0]).not.toHaveProperty('creatorProfileId');
  });

  it('removes an Official Pattern without deleting its identity or stored object references', async () => {
    const entity = pattern();
    const originalReferences = {
      artifactObjectKey: entity.artifactObjectKey,
      id: entity.id,
      previewObjectKey: entity.previewObjectKey,
      thumbnailRendererVersion: entity.thumbnailRendererVersion,
    };
    const { save, service } = serviceWithTransactionPattern(entity);

    const result = await service.removePattern('operator-id', entity.id, 'request-id');

    expect(result).toMatchObject({ patternType: 'official', status: 'removed' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(entity).toMatchObject(originalReferences);
  });

  it('rejects generic removal for a Community Pattern at the backend boundary', async () => {
    const entity = pattern({ creatorProfileId: '00000000-0000-4000-8000-000000000002' });
    const { auditLog, save, service } = serviceWithTransactionPattern(entity);

    await expect(service.removePattern('operator-id', entity.id, 'request-id')).rejects.toThrow(
      new BadRequestException(
        'Community Patterns can only be removed through Post-Publication Review',
      ),
    );
    expect(entity.status).toBe('available');
    expect(save).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });
});

/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-type-assertion */
describe('AdminCatalogService bulk removal', () => {
  function setup(
    patterns: PatternEntity[],
    picks: { patternId: string; position: number; pattern: PatternEntity }[] = [],
  ) {
    const patternSave = jest.fn((values: PatternEntity[]) => Promise.resolve(values));
    const getMany = jest.fn().mockResolvedValue(patterns);
    const patternQueryBuilder = {
      andWhere: jest.fn().mockReturnThis(),
      getMany,
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const deleteExecute = jest.fn().mockResolvedValue(undefined);
    const staffSave = jest.fn().mockResolvedValue(undefined);
    const patternRepository = {
      createQueryBuilder: jest.fn(() => patternQueryBuilder),
      save: patternSave,
    };
    const staffRepository = {
      create: jest.fn((value) => value),
      createQueryBuilder: jest.fn(() => ({ delete: jest.fn(() => ({ execute: deleteExecute })) })),
      find: jest.fn().mockResolvedValue(picks),
      save: staffSave,
    };
    let receipt: Record<string, unknown> | null = null;
    const receiptRepository = {
      create: jest.fn((value) => value),
      findOneBy: jest.fn(() => Promise.resolve(receipt)),
      save: jest.fn((value) => {
        receipt = value;
        return Promise.resolve(value);
      }),
    };
    const manager = {
      getRepository: jest.fn((entity) => entity.name === 'PatternEntity'
        ? patternRepository
        : entity.name === 'BulkPatternRemovalEntity' ? receiptRepository : staffRepository),
      query: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
    };
    const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new AdminCatalogService(
      dataSource as never,
      { publicUrl: (key: string) => `https://cdn.test/${key}` } as never,
      auditLog as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
    );
    return { auditLog, deleteExecute, patternSave, receiptRepository, service, staffSave };
  }

  it('removes every eligible Pattern, audits the shared batch, and compacts Staff Picks', async () => {
    const first = pattern();
    const second = pattern({ id: '00000000-0000-4000-8000-000000000002', status: 'withdrawn', title: 'Owl' });
    const thirdId = '00000000-0000-4000-8000-000000000003';
    const third = pattern({ id: thirdId, title: 'Bee' });
    const { auditLog, patternSave, service, staffSave } = setup(
      [first, second],
      [
        { pattern: first, patternId: first.id, position: 1 },
        { pattern: third, patternId: thirdId, position: 2 },
        { pattern: second, patternId: second.id, position: 3 },
      ],
    );

    await expect(service.bulkRemovePatterns(
      'operator-id', [first.id, second.id], 'Confirmed policy removal',
      '00000000-0000-4000-8000-000000000099', 'request-id',
    )).resolves.toEqual({
      batchId: '00000000-0000-4000-8000-000000000099',
      patternIds: [first.id, second.id],
      removedCount: 2,
    });

    expect(patternSave).toHaveBeenCalledWith([first, second]);
    expect(first.status).toBe('removed');
    expect(second.status).toBe('removed');
    expect(staffSave).toHaveBeenCalledWith([{ patternId: thirdId, position: 1 }]);
    expect(auditLog.record).toHaveBeenCalledTimes(3);
    expect(auditLog.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'pattern.bulk_remove', requestId: 'request-id',
      after: expect.objectContaining({ batchId: '00000000-0000-4000-8000-000000000099', reason: 'Confirmed policy removal' }),
    }));
    expect(auditLog.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'staffpick.bulk_remove_compact',
      requestId: 'request-id',
      before: expect.objectContaining({
        batchId: '00000000-0000-4000-8000-000000000099',
        picks: [
          expect.objectContaining({ patternId: first.id, position: 1 }),
          expect.objectContaining({ patternId: thirdId, position: 2 }),
          expect.objectContaining({ patternId: second.id, position: 3 }),
        ],
        reason: 'Confirmed policy removal',
      }),
      after: expect.objectContaining({
        picks: [expect.objectContaining({ patternId: thirdId, position: 1 })],
      }),
      targetType: 'staff_picks',
    }));
  });

  it('returns the original successful result for an exact replay without repeated writes', async () => {
    const first = pattern();
    const { auditLog, deleteExecute, patternSave, service } = setup([first]);
    const invoke = () => service.bulkRemovePatterns(
      'operator-id', [first.id], '  Confirmed policy removal  ',
      '00000000-0000-4000-8000-000000000099', 'request-id',
    );

    const original = await invoke();
    const replay = await invoke();

    expect(replay).toEqual(original);
    expect(patternSave).toHaveBeenCalledTimes(1);
    expect(deleteExecute).toHaveBeenCalledTimes(1);
    expect(auditLog.record).toHaveBeenCalledTimes(2);
  });

  it('rejects a reused batch ID with a different normalized payload without mutation', async () => {
    const first = pattern();
    const second = pattern({ id: '00000000-0000-4000-8000-000000000002' });
    const { auditLog, patternSave, service } = setup([first]);
    await service.bulkRemovePatterns(
      'operator-id', [first.id], 'Confirmed policy removal',
      '00000000-0000-4000-8000-000000000099', 'request-id',
    );

    await expect(service.bulkRemovePatterns(
      'operator-id', [second.id], 'Confirmed policy removal',
      '00000000-0000-4000-8000-000000000099', 'retry-request',
    )).rejects.toThrow('batch ID was already used with a different request');
    expect(patternSave).toHaveBeenCalledTimes(1);
    expect(auditLog.record).toHaveBeenCalledTimes(2);
  });

  it('rejects a reused batch ID with a different normalized reason without mutation', async () => {
    const first = pattern();
    const { auditLog, patternSave, service } = setup([first]);
    await service.bulkRemovePatterns(
      'operator-id', [first.id], 'Confirmed policy removal',
      '00000000-0000-4000-8000-000000000099', 'request-id',
    );

    await expect(service.bulkRemovePatterns(
      'operator-id', [first.id], 'Confirmed legal removal',
      '00000000-0000-4000-8000-000000000099', 'retry-request',
    )).rejects.toThrow('batch ID was already used with a different request');
    expect(patternSave).toHaveBeenCalledTimes(1);
    expect(auditLog.record).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing', [pattern()], ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']],
    ['community', [pattern({ creatorProfileId: '00000000-0000-4000-8000-000000000010' })], ['00000000-0000-4000-8000-000000000001']],
    ['review hold', [pattern({ status: 'review_hold' })], ['00000000-0000-4000-8000-000000000001']],
    ['already removed', [pattern({ status: 'removed' })], ['00000000-0000-4000-8000-000000000001']],
  ])('rejects an ineligible %s selection without writes', async (_case, values, ids) => {
    const { auditLog, patternSave, service, staffSave } = setup(values);
    await expect(service.bulkRemovePatterns(
      'operator-id', ids, 'Confirmed policy removal',
      '00000000-0000-4000-8000-000000000099', 'request-id',
    )).rejects.toThrow(BadRequestException);
    expect(patternSave).not.toHaveBeenCalled();
    expect(staffSave).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('rejects duplicate IDs before opening a transaction', async () => {
    const entity = pattern();
    const { patternSave, service } = setup([entity]);
    await expect(service.bulkRemovePatterns(
      'operator-id', [entity.id, entity.id], 'Confirmed policy removal',
      '00000000-0000-4000-8000-000000000099', 'request-id',
    )).rejects.toThrow('Bulk removal Pattern IDs must be unique');
    expect(patternSave).not.toHaveBeenCalled();
  });
});
/* eslint-enable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unnecessary-type-assertion */
