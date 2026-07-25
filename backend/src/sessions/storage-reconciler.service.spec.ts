import { Repository } from 'typeorm';

import { ObjectStorage } from '../catalog/storage/object-storage.interface';
import { ObjectRegistryEntity } from './entities/object-registry.entity';
import { StorageReconcilerService } from './storage-reconciler.service';

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
      exists: jest.fn(async (key: string) => key === 'patterns/healthy.bin'),
      list: jest.fn().mockResolvedValue([
        'patterns/healthy.bin',
        'drafts/uploading.bin',
        'patterns/orphan.bin',
      ]),
    } as unknown as ObjectStorage;
    const service = new StorageReconcilerService(repository, storage);

    await expect(service.reportDiscrepancies()).resolves.toEqual({
      registryMissingObjectKeys: ['patterns/missing.bin'],
      storageOrphanObjectKeys: ['patterns/orphan.bin'],
    });
  });
});
