import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ObjectRegistryEntity } from './entities/object-registry.entity';
import { OBJECT_STORAGE, ObjectStorage } from '../catalog/storage/object-storage.interface';

export interface StorageReconciliationDiscrepancies {
  registryMissingObjectKeys: readonly string[];
  storageOrphanObjectKeys: readonly string[];
}

@Injectable()
export class StorageReconcilerService {
  private readonly logger = new Logger(StorageReconcilerService.name);

  constructor(
    @InjectRepository(ObjectRegistryEntity)
    private readonly objectRegistryRepo: Repository<ObjectRegistryEntity>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async reconcileOnce(thresholdSeconds?: number): Promise<void> {
    const threshold = thresholdSeconds ?? 86400; // 24 hours default
    const cutoff = new Date(Date.now() - threshold * 1000);

    // 1. Stuck uploading
    const uploadingRows = await this.objectRegistryRepo.find({
      where: {
        state: 'uploading',
        updatedAt: LessThan(cutoff),
      },
    });

    for (const row of uploadingRows) {
      this.logger.log(`Reconciler: Deleting stuck uploading object: ${row.objectKey}`);
      try {
        await this.storage.delete(row.objectKey);
      } catch (error) {
        this.logger.error(`Failed to delete object file for key ${row.objectKey}:`, error);
      }
      await this.objectRegistryRepo.delete({ objectKey: row.objectKey });
    }

    // 2. Missing committed/available
    const activeRows = await this.objectRegistryRepo.find({
      where: [
        { state: 'committed' },
        { state: 'available' },
      ],
    });

    for (const row of activeRows) {
      const exists = await this.storage.exists(row.objectKey);
      if (!exists) {
        this.logger.warn(`Reconciler: Object file is missing for key: ${row.objectKey}`);
        if (!row.missing) {
          await this.objectRegistryRepo.update({ objectKey: row.objectKey }, { missing: true });
        }
      } else {
        if (row.missing) {
          await this.objectRegistryRepo.update({ objectKey: row.objectKey }, { missing: false });
        }
      }
    }
  }

  /**
   * Read-only storage comparison used by the operator reconciliation report.
   * Cleanup stays in reconcileOnce; this method deliberately never deletes or
   * mutates registry rows.
   */
  async reportDiscrepancies(): Promise<StorageReconciliationDiscrepancies> {
    const activeRows = await this.objectRegistryRepo.find({
      where: [{ state: 'committed' }, { state: 'available' }],
    });
    const registryRows = await this.objectRegistryRepo.find();
    const missing: string[] = [];

    for (const row of activeRows) {
      if (!(await this.storage.exists(row.objectKey))) {
        missing.push(row.objectKey);
      }
    }

    const registeredKeys = new Set(registryRows.map((row) => row.objectKey));
    const storedKeys = await this.storage.list();
    const orphans = storedKeys.filter((key) => !registeredKeys.has(key));

    return {
      registryMissingObjectKeys: missing,
      storageOrphanObjectKeys: orphans,
    };
  }
}
