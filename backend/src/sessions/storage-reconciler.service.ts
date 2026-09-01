import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, LessThan } from 'typeorm';
import { ObjectRegistryEntity } from './entities/object-registry.entity';
import { OBJECT_STORAGE, ObjectStorage } from '../catalog/storage/object-storage.interface';
import { AppConfigService } from '../config/app-config.service';

export interface StorageReconciliationDiscrepancies {
  registryMissingObjectKeys: readonly string[];
  storageOrphanObjectKeys: readonly string[];
}

export interface StorageReconciliationSummary {
  /** True when a previous pass was still running and this call did no work. */
  skipped: boolean;
  deletedStuckUploads: number;
  verifiedObjects: number;
  markedMissing: number;
  markedRestored: number;
}

const ACTIVE_STATES = ['committed', 'available'] as const;

const SKIPPED_SUMMARY: StorageReconciliationSummary = {
  skipped: true,
  deletedStuckUploads: 0,
  verifiedObjects: 0,
  markedMissing: 0,
  markedRestored: 0,
};

@Injectable()
export class StorageReconcilerService {
  private readonly logger = new Logger(StorageReconcilerService.name);
  private activePass: Promise<StorageReconciliationSummary> | null = null;

  constructor(
    @InjectRepository(ObjectRegistryEntity)
    private readonly objectRegistryRepo: Repository<ObjectRegistryEntity>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Runs one bounded reconciliation pass. Passes never overlap: while one is in
   * flight every further call returns immediately as skipped, so a slow pass can
   * not stack up remote existence checks.
   */
  reconcileOnce(thresholdSeconds?: number): Promise<StorageReconciliationSummary> {
    if (this.activePass !== null) {
      this.logger.warn('Reconciler: previous pass still running, skipping this tick');
      return Promise.resolve(SKIPPED_SUMMARY);
    }

    const pass = this.runPass(thresholdSeconds).finally(() => {
      this.activePass = null;
    });
    this.activePass = pass;
    return pass;
  }

  private async runPass(
    thresholdSeconds?: number,
  ): Promise<StorageReconciliationSummary> {
    const threshold = thresholdSeconds ?? 86400; // 24 hours default
    const cutoff = new Date(Date.now() - threshold * 1000);
    const batchSize = this.config.storageReconcilerBatchSize;

    const deletedStuckUploads = await this.deleteStuckUploads(cutoff, batchSize);

    // Remote existence checks are the only part of the pass that costs object
    // storage requests, so they are separately switchable. While they are off
    // the pass still cleans up stuck uploads, and the operator reconciliation
    // report keeps detecting missing objects from its single bucket listing.
    if (!this.config.storageObjectVerificationEnabled) {
      return {
        skipped: false,
        deletedStuckUploads,
        verifiedObjects: 0,
        markedMissing: 0,
        markedRestored: 0,
      };
    }

    const verification = await this.verifyActiveObjects(batchSize);

    return {
      skipped: false,
      deletedStuckUploads,
      ...verification,
    };
  }

  private async deleteStuckUploads(cutoff: Date, batchSize: number): Promise<number> {
    const uploadingRows = await this.objectRegistryRepo.find({
      where: {
        state: 'uploading',
        updatedAt: LessThan(cutoff),
      },
      take: batchSize,
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

    return uploadingRows.length;
  }

  /**
   * Verifies at most `batchSize` active objects whose last verification is older
   * than the configured verification interval, oldest (and never verified) first.
   * The rest of the registry is picked up by later ticks, which keeps remote
   * `exists` traffic proportional to the batch size rather than to the whole
   * bucket on every tick.
   */
  private async verifyActiveObjects(batchSize: number): Promise<{
    verifiedObjects: number;
    markedMissing: number;
    markedRestored: number;
  }> {
    const verificationCutoff = new Date(
      Date.now() - this.config.storageObjectVerificationIntervalSeconds * 1000,
    );

    const staleRows = await this.objectRegistryRepo.find({
      where: [
        { state: In([...ACTIVE_STATES]), lastVerifiedAt: IsNull() },
        { state: In([...ACTIVE_STATES]), lastVerifiedAt: LessThan(verificationCutoff) },
      ],
      // Never-verified rows first; Postgres would otherwise sort NULLs last and
      // starve freshly registered objects behind the existing backlog.
      order: { lastVerifiedAt: { direction: 'ASC', nulls: 'FIRST' } },
      take: batchSize,
    });

    let markedMissing = 0;
    let markedRestored = 0;

    for (const row of staleRows) {
      const exists = await this.storage.exists(row.objectKey);
      const verifiedAt = new Date();

      if (!exists && !row.missing) {
        this.logger.warn(`Reconciler: Object file is missing for key: ${row.objectKey}`);
        markedMissing += 1;
      } else if (exists && row.missing) {
        this.logger.log(`Reconciler: Object file restored for key: ${row.objectKey}`);
        markedRestored += 1;
      }

      await this.objectRegistryRepo.update(
        { objectKey: row.objectKey },
        { missing: !exists, lastVerifiedAt: verifiedAt },
      );
    }

    return {
      verifiedObjects: staleRows.length,
      markedMissing,
      markedRestored,
    };
  }

  /**
   * Read-only storage comparison used by the operator reconciliation report.
   * Cleanup stays in reconcileOnce; this method deliberately never deletes or
   * mutates registry rows.
   *
   * Both sides are derived from a single bucket listing, so the report costs one
   * paginated `list` instead of one remote existence check per active object.
   */
  async reportDiscrepancies(): Promise<StorageReconciliationDiscrepancies> {
    const activeRows = await this.objectRegistryRepo.find({
      where: [{ state: 'committed' }, { state: 'available' }],
    });
    const registryRows = await this.objectRegistryRepo.find();
    const storedKeys = new Set(await this.storage.list());

    const missing = activeRows
      .map((row) => row.objectKey)
      .filter((objectKey) => !storedKeys.has(objectKey));

    const registeredKeys = new Set(registryRows.map((row) => row.objectKey));
    const orphans = [...storedKeys].filter((key) => !registeredKeys.has(key));

    return {
      registryMissingObjectKeys: missing,
      storageOrphanObjectKeys: orphans,
    };
  }
}
