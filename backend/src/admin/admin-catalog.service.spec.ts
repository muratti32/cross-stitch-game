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
