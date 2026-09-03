import { BadRequestException } from '@nestjs/common';

import { CategoryEntity, CategoryLabelEntity, PatternEntity, TagEntity } from '../catalog/entities';
import { RELEASED_APP_DISPLAY_LOCALES } from '../catalog/released-locales.constant';
import { AdminCatalogService } from './admin-catalog.service';

// Taxonomy writes require a label for every released App Display Language, so
// specs build the complete set and only override the locales they assert on.
function completeLabels(overrides: Record<string, string> = {}): { locale: string; label: string }[] {
  return RELEASED_APP_DISPLAY_LOCALES.map((locale) => ({
    locale,
    label: overrides[locale] ?? `Label ${locale}`,
  }));
}

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

/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion */
describe('AdminCatalogService category labels', () => {
  it('creates and updates multiple locale labels without changing the code', async () => {
    const category = Object.assign(new CategoryEntity(), { code: 'animals', active: true, labels: [] });
    const categories = {
      create: jest.fn((value) => value),
      find: jest.fn().mockResolvedValue([category]),
      findOne: jest.fn(({ where }) => Promise.resolve(where.code === 'animals' ? category : null)),
      save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
    };
    const labelRows: CategoryLabelEntity[] = [];
    const labels = {
      create: jest.fn((value) => value),
      findOne: jest.fn(({ where }) => Promise.resolve(labelRows.find((row) => row.locale === where.locale) ?? null)),
      save: jest.fn().mockImplementation((value) => {
        for (const row of Array.isArray(value) ? value : [value]) {
          const index = labelRows.findIndex((existing) => existing.locale === row.locale);
          if (index === -1) labelRows.push(row);
          else labelRows[index] = row;
        }
        return Promise.resolve(value);
      }),
    };
    const manager = {
      getRepository: jest.fn((entity) => entity === CategoryEntity ? categories : labels),
    };
    const service = new AdminCatalogService(
      { transaction: jest.fn((callback) => callback(manager)) } as never,
      {} as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never, {} as never, {} as never, {} as never, categories as never, labels as never,
    );

    await service.createCategory('operator', 'new-category',
      completeLabels({ en: 'New Category', tr: 'Yeni Kategori' }), 'request');
    expect(labels.save).toHaveBeenCalled();
    const updated = await service.updateCategoryLabels('operator', 'animals',
      completeLabels({ en: 'Animals Updated', tr: 'Hayvanlar' }), 'request');
    expect(updated).toMatchObject({ code: 'animals' });
    expect(updated.labels.map((row) => row.locale).sort()).toEqual([...RELEASED_APP_DISPLAY_LOCALES].sort());
    expect(updated.labels.find((row) => row.locale === 'tr')).toMatchObject({ label: 'Hayvanlar' });
    expect(category.code).toBe('animals');
  });
});

describe('AdminCatalogService taxonomy label completeness', () => {
  function makeService() {
    const categorySave = jest.fn();
    const tagSave = jest.fn();
    const categoryLabels = { save: jest.fn(), create: jest.fn((value) => value), findOne: jest.fn() };
    const tagLabels = { save: jest.fn(), create: jest.fn((value) => value), findOne: jest.fn() };
    const categories = { save: categorySave, create: jest.fn((value) => value), findOne: jest.fn().mockResolvedValue(null) };
    const tags = { save: tagSave, create: jest.fn((value) => value), findOne: jest.fn().mockResolvedValue(null) };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === CategoryEntity) return categories;
        if (entity === CategoryLabelEntity) return categoryLabels;
        if (entity === TagEntity) return tags;
        return tagLabels;
      }),
    };
    const dataSource = { transaction: jest.fn((callback) => callback(manager)) };
    const service = new AdminCatalogService(
      dataSource as never, {} as never, { record: jest.fn() } as never,
      {} as never, tags as never, tagLabels as never, {} as never,
      categories as never, categoryLabels as never,
    );
    return { service, categorySave, tagSave, dataSource };
  }

  it.each([
    ['create category', (service: AdminCatalogService) => service.createCategory('operator', 'animals', [{ locale: 'en', label: 'Animals' }], null)],
    ['update category labels', (service: AdminCatalogService) => service.updateCategoryLabels('operator', 'animals', [{ locale: 'en', label: 'Animals' }], null)],
    ['create tag', (service: AdminCatalogService) => service.createTag('operator', 'animals', [{ locale: 'en', label: 'Animals' }], null)],
    ['update tag labels', (service: AdminCatalogService) => service.updateTagLabels('operator', 'animals', [{ locale: 'en', label: 'Animals' }], null)],
  ])('%s rejects missing released locale before writes', async (_name, operation) => {
    const { service, categorySave, tagSave, dataSource } = makeService();

    await expect(operation(service)).rejects.toThrow('tr');
    expect(categorySave).not.toHaveBeenCalled();
    expect(tagSave).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('names English when both released labels are missing', async () => {
    const { service } = makeService();
    await expect(service.createTag('operator', 'animals', [], null)).rejects.toThrow(/en.*tr|tr.*en/);
  });

  it('names English when the submitted set omits English', async () => {
    const { service } = makeService();
    await expect(service.createCategory('operator', 'animals', [{ locale: 'tr', label: 'Hayvanlar' }], null))
      .rejects.toThrow('en');
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
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
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

  it('canonicalizes UUID case and selection order before binding the replay payload', async () => {
    const first = pattern({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1' });
    const second = pattern({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2' });
    const { patternSave, service } = setup([first, second]);
    const uppercaseBatchId = 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCC3';

    const original = await service.bulkRemovePatterns(
      'operator-id',
      [second.id.toUpperCase(), first.id.toUpperCase()],
      'Confirmed policy removal',
      uppercaseBatchId,
      'request-id',
    );
    const replay = await service.bulkRemovePatterns(
      'operator-id',
      [first.id, second.id],
      'Confirmed policy removal',
      uppercaseBatchId.toLowerCase(),
      'retry-request-id',
    );

    expect(original).toEqual({
      batchId: uppercaseBatchId.toLowerCase(),
      patternIds: [first.id, second.id],
      removedCount: 2,
    });
    expect(replay).toEqual(original);
    expect(patternSave).toHaveBeenCalledTimes(1);
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
