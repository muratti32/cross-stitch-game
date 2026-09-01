import { FindManyOptions, Repository } from 'typeorm';

import { ObjectStorage } from '../catalog/storage/object-storage.interface';
import { AppConfigService } from '../config/app-config.service';
import { ObjectRegistryEntity } from './entities/object-registry.entity';
import { StorageReconcilerService } from './storage-reconciler.service';

function config(overrides: Partial<{
  batchSize: number;
  verificationIntervalSeconds: number;
  verificationEnabled: boolean;
}> = {}): AppConfigService {
  return {
    storageObjectVerificationEnabled: overrides.verificationEnabled ?? true,
    storageReconcilerBatchSize: overrides.batchSize ?? 250,
    storageObjectVerificationIntervalSeconds:
      overrides.verificationIntervalSeconds ?? 86400,
  } as unknown as AppConfigService;
}

type FindMock = jest.Mock<
  Promise<Partial<ObjectRegistryEntity>[]>,
  [FindManyOptions<ObjectRegistryEntity>]
>;

describe('StorageReconcilerService bounded sweep', () => {
  it('verifies only a stale batch of active objects and records the verification time', async () => {
    const find: FindMock = jest
      .fn<Promise<Partial<ObjectRegistryEntity>[]>, [FindManyOptions<ObjectRegistryEntity>]>()
      .mockResolvedValueOnce([]) // stuck uploads
      .mockResolvedValueOnce([
        { objectKey: 'patterns/a.bin', missing: false },
        { objectKey: 'patterns/b.bin', missing: false },
      ]);
    const update = jest.fn().mockResolvedValue(undefined);
    const repository = { find, update } as unknown as Repository<ObjectRegistryEntity>;
    const storage = {
      exists: jest.fn((key: string) => Promise.resolve(key !== 'patterns/b.bin')),
      delete: jest.fn(),
    } as unknown as ObjectStorage;
    const service = new StorageReconcilerService(
      repository,
      storage,
      config({ batchSize: 2 }),
    );

    const summary = await service.reconcileOnce();

    expect(summary).toEqual({
      skipped: false,
      deletedStuckUploads: 0,
      verifiedObjects: 2,
      markedMissing: 1,
      markedRestored: 0,
    });

    const activeQuery = find.mock.calls[1][0];
    expect(activeQuery.take).toBe(2);
    expect(activeQuery.order).toEqual({
      lastVerifiedAt: { direction: 'ASC', nulls: 'FIRST' },
    });
    expect(find).toHaveBeenCalledTimes(2);
    expect(storage.exists).toHaveBeenCalledTimes(2);

    const anyDate = expect.any(Date) as Date;
    expect(update).toHaveBeenCalledWith(
      { objectKey: 'patterns/a.bin' },
      expect.objectContaining({ missing: false, lastVerifiedAt: anyDate }),
    );
    expect(update).toHaveBeenCalledWith(
      { objectKey: 'patterns/b.bin' },
      expect.objectContaining({ missing: true, lastVerifiedAt: anyDate }),
    );
  });

  it('issues no remote existence checks while verification is disabled', async () => {
    const find = jest
      .fn()
      .mockResolvedValueOnce([]) // stuck uploads
      .mockResolvedValue([{ objectKey: 'patterns/a.bin', missing: false }]);
    const update = jest.fn().mockResolvedValue(undefined);
    const repository = { find, update } as unknown as Repository<ObjectRegistryEntity>;
    const storage = {
      exists: jest.fn(),
      delete: jest.fn(),
    } as unknown as ObjectStorage;
    const service = new StorageReconcilerService(
      repository,
      storage,
      config({ verificationEnabled: false }),
    );

    const summary = await service.reconcileOnce();

    expect(summary).toEqual({
      skipped: false,
      deletedStuckUploads: 0,
      verifiedObjects: 0,
      markedMissing: 0,
      markedRestored: 0,
    });
    expect(storage.exists).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    // Only the stuck-upload query runs; active rows are never even loaded.
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('still deletes stuck uploads while verification is disabled', async () => {
    const find = jest
      .fn()
      .mockResolvedValueOnce([{ objectKey: 'drafts/stuck.bin' }])
      .mockResolvedValue([]);
    const repository = {
      find,
      delete: jest.fn().mockResolvedValue(undefined),
      update: jest.fn(),
    } as unknown as Repository<ObjectRegistryEntity>;
    const storage = {
      exists: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    } as unknown as ObjectStorage;
    const service = new StorageReconcilerService(
      repository,
      storage,
      config({ verificationEnabled: false }),
    );

    const summary = await service.reconcileOnce();

    expect(summary.deletedStuckUploads).toBe(1);
    expect(storage.delete).toHaveBeenCalledWith('drafts/stuck.bin');
    expect(storage.exists).not.toHaveBeenCalled();
  });

  it('clears the missing flag once an object is restored', async () => {
    const find = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ objectKey: 'patterns/restored.bin', missing: true }]);
    const update = jest.fn().mockResolvedValue(undefined);
    const repository = { find, update } as unknown as Repository<ObjectRegistryEntity>;
    const storage = {
      exists: jest.fn().mockResolvedValue(true),
      delete: jest.fn(),
    } as unknown as ObjectStorage;
    const service = new StorageReconcilerService(repository, storage, config());

    const summary = await service.reconcileOnce();

    expect(summary.markedRestored).toBe(1);
    expect(update).toHaveBeenCalledWith(
      { objectKey: 'patterns/restored.bin' },
      expect.objectContaining({ missing: false }),
    );
  });

  it('skips a tick while a previous pass is still running', async () => {
    let releaseExists: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseExists = resolve;
    });
    const find = jest
      .fn()
      .mockResolvedValue([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ objectKey: 'patterns/slow.bin', missing: false }]);
    const repository = {
      find,
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as Repository<ObjectRegistryEntity>;
    const storage = {
      exists: jest.fn(async () => {
        await blocked;
        return true;
      }),
      delete: jest.fn(),
    } as unknown as ObjectStorage;
    const service = new StorageReconcilerService(repository, storage, config());

    const firstPass = service.reconcileOnce();
    await expect(service.reconcileOnce()).resolves.toEqual({
      skipped: true,
      deletedStuckUploads: 0,
      verifiedObjects: 0,
      markedMissing: 0,
      markedRestored: 0,
    });

    releaseExists?.();
    await expect(firstPass).resolves.toMatchObject({ skipped: false, verifiedObjects: 1 });
    expect(storage.exists).toHaveBeenCalledTimes(1);

    // The guard is released once the pass settles, so later ticks run again.
    await expect(service.reconcileOnce()).resolves.toMatchObject({ skipped: false });
  });

  it('releases the in-flight guard when a pass fails', async () => {
    const repository = {
      find: jest
        .fn()
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValue([]),
      update: jest.fn(),
    } as unknown as Repository<ObjectRegistryEntity>;
    const storage = { exists: jest.fn(), delete: jest.fn() } as unknown as ObjectStorage;
    const service = new StorageReconcilerService(repository, storage, config());

    await expect(service.reconcileOnce()).rejects.toThrow('db down');
    await expect(service.reconcileOnce()).resolves.toMatchObject({ skipped: false });
  });
});

describe('StorageReconcilerService reporting', () => {
  it('reports missing active registry rows and storage orphans without reporting healthy objects', async () => {
    const repository = {
      find: jest
        .fn()
        .mockResolvedValueOnce([
          { objectKey: 'patterns/missing.bin' },
          { objectKey: 'patterns/healthy.bin' },
        ])
        .mockResolvedValueOnce([
          { objectKey: 'patterns/missing.bin' },
          { objectKey: 'patterns/healthy.bin' },
          { objectKey: 'drafts/uploading.bin' },
        ]),
    } as unknown as Repository<ObjectRegistryEntity>;
    const storage = {
      exists: jest.fn(),
      list: jest.fn().mockResolvedValue([
        'patterns/healthy.bin',
        'drafts/uploading.bin',
        'patterns/orphan.bin',
      ]),
    } as unknown as ObjectStorage;
    const service = new StorageReconcilerService(repository, storage, config());

    await expect(service.reportDiscrepancies()).resolves.toEqual({
      registryMissingObjectKeys: ['patterns/missing.bin'],
      storageOrphanObjectKeys: ['patterns/orphan.bin'],
    });
    // The report derives both sides from one listing, never per-object HEAD requests.
    expect(storage.exists).not.toHaveBeenCalled();
    expect(storage.list).toHaveBeenCalledTimes(1);
  });
});
