import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';

import { captureWorkerFailure } from '../observability/sentry';
import { BUNDLED_STARTERS, type BundledStarter } from './bundled-starters.generated';
import { registerCatalogObject } from './catalog-object-registry';
import { catalogPatternObjectKeys } from './pattern-object-keys';
import { OBJECT_STORAGE, type ObjectStorage } from './storage/object-storage.interface';

/**
 * Puts each starter in the catalog: objects first, row last, so a row always
 * has its bytes and a partial run just repeats. An existing row is left alone,
 * which keeps operator edits and never restores a removed starter's objects.
 */
@Injectable()
export class BundledStarterSeeder {
  private readonly logger = new Logger(BundledStarterSeeder.name);
  private seeded = false;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Never rejects: the worker calls it on a timer until one run succeeds. */
  async ensure(): Promise<void> {
    if (this.seeded) return;
    try {
      for (const starter of BUNDLED_STARTERS) {
        await this.seed(starter);
      }
      this.seeded = true;
    } catch (error: unknown) {
      this.logger.error(
        `Seeding Bundled Starter Patterns failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      captureWorkerFailure(error, 'bundled_starter_seed');
    }
  }

  private async seed(starter: BundledStarter): Promise<void> {
    const existing = await this.dataSource.query<readonly { checksum: string }[]>(
      `SELECT artifact_checksum AS checksum FROM catalog.patterns WHERE id = $1`,
      [starter.id],
    );
    if (existing[0]) {
      if (existing[0].checksum.trim() !== starter.artifact.checksum) {
        this.logger.warn(`Bundled starter ${starter.id} has a catalog row with a different checksum`);
      }
      return;
    }

    const keys = catalogPatternObjectKeys(starter.id);
    const artifact = Buffer.from(starter.artifact.base64, 'base64');
    const preview = Buffer.from(starter.previewBase64, 'base64');
    await this.storage.put(keys.artifact, artifact, 'application/octet-stream');
    await this.storage.put(keys.preview, preview, 'image/png');

    await this.dataSource.transaction(async (manager) => {
      await registerCatalogObject(manager, keys.artifact, starter.artifact.checksum, artifact.length);
      await registerCatalogObject(
        manager,
        keys.preview,
        createHash('sha256').update(preview).digest('hex'),
        preview.length,
      );
      await manager.query(
        `INSERT INTO catalog.patterns (
           id, title, description, creator_name, category_code, width, height,
           palette_size, stitchable_cell_count, artifact_object_key, artifact_checksum,
           artifact_byte_length, artifact_schema_version, preview_object_key, published_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO NOTHING`,
        [
          starter.id,
          starter.title,
          starter.description,
          starter.creatorName,
          starter.categoryCode,
          starter.width,
          starter.height,
          starter.paletteSize,
          starter.stitchableCellCount,
          keys.artifact,
          starter.artifact.checksum,
          starter.artifact.byteLength,
          starter.artifact.schemaVersion,
          keys.preview,
          starter.publishedAt,
        ],
      );
    });
  }
}
