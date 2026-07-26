import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';

import { OBJECT_STORAGE, ObjectStorage } from '../catalog/storage/object-storage.interface';
import { PatternObjectKeySet, personalPatternObjectKeys } from '../catalog/pattern-object-keys';
import { ObjectRegistryEntity } from '../sessions/entities';
import { captureOperationalAlert } from '../observability/sentry';
import { renderPatternThumbnailPng, PATTERN_THUMBNAIL_RENDERER_VERSION } from './pattern-thumbnail-renderer';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

@Injectable()
export class PatternThumbnailStagingService {
  private readonly logger = new Logger(PatternThumbnailStagingService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Renders both Pattern Thumbnail variants and stages them into object storage
   * and the object registry. NEVER throws: Thumbnail rendering is decorative and
   * must never cost a player a Pattern Conversion they spent AI Credit on
   * (ADR-0042). On any failure the Pattern is left without a Thumbnail and this
   * returns null.
   */
  async stagePersonalPatternThumbnails(input: {
    patternId: string;
    width: number;
    height: number;
    palette: { dmcCode: string; name: string; rgbHex: string }[];
    grid: Uint8Array;
  }): Promise<{ readonly version: number; readonly keys: readonly string[] } | null> {
    const keys = personalPatternObjectKeys(input.patternId);

    return this.stageThumbnails({
      grid: input.grid,
      height: input.height,
      idForLogging: input.patternId,
      keys,
      ownerLabel: 'pattern',
      palette: input.palette,
      width: input.width,
    });
  }

  /**
   * Renders both Pattern Thumbnail variants and stages them under the supplied
   * object keys. NEVER throws: a Thumbnail is decorative and callers must be
   * able to complete their conversion or publication without one (ADR-0042).
   */
  async stageThumbnails(input: {
    ownerLabel: string;
    idForLogging: string;
    keys: Pick<PatternObjectKeySet, 'thumbnailBrowsing' | 'thumbnailDetail'>;
    width: number;
    height: number;
    palette: { dmcCode: string; name: string; rgbHex: string }[];
    grid: Uint8Array;
  }): Promise<{ readonly version: number; readonly keys: readonly string[] } | null> {
    const { keys } = input;

    try {
      // Render BOTH variants first (browsing, then detail) — render before any storage write, so a renderer throw stages nothing.
      const browsingBytes = renderPatternThumbnailPng({
        width: input.width,
        height: input.height,
        palette: input.palette,
        grid: input.grid,
        variant: 'browsing',
      });

      const detailBytes = renderPatternThumbnailPng({
        width: input.width,
        height: input.height,
        palette: input.palette,
        grid: input.grid,
        variant: 'detail',
      });

      // Stage each variant
      await this.stageObject(keys.thumbnailBrowsing, browsingBytes, 'image/png');
      await this.stageObject(keys.thumbnailDetail, detailBytes, 'image/png');

      return {
        version: PATTERN_THUMBNAIL_RENDERER_VERSION,
        keys: [keys.thumbnailBrowsing, keys.thumbnailDetail] as const,
      };
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Pattern Thumbnail rendering/staging failed for ${input.ownerLabel} ${input.idForLogging}: ${reason}`,
      );

      captureOperationalAlert(
        'Pattern Thumbnail rendering failed',
        'warning',
        'pattern-thumbnail-render-failure',
        { ownerLabel: input.ownerLabel, patternId: input.idForLogging, reason },
      );

      // Best-effort cleanup so no half-staged objects linger
      try {
        await Promise.allSettled([
          this.storage.delete(keys.thumbnailBrowsing),
          this.storage.delete(keys.thumbnailDetail),
        ]);

        await this.dataSource
          .getRepository(ObjectRegistryEntity)
          .createQueryBuilder()
          .delete()
          .where('object_key IN (:...keys)', {
            keys: [keys.thumbnailBrowsing, keys.thumbnailDetail],
          })
          .andWhere('state <> :state', { state: 'available' })
          .execute();
      } catch (cleanupError: unknown) {
        const cleanupReason = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        this.logger.error(
          `Pattern Thumbnail cleanup failed for ${input.ownerLabel} ${input.idForLogging}: ${cleanupReason}`,
        );
      }

      return null;
    }
  }

  private async stageObject(
    key: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<void> {
    const checksum = sha256(bytes);
    await this.dataSource.getRepository(ObjectRegistryEntity).upsert(
      {
        byteLength: bytes.length,
        checksum,
        missing: false,
        objectKey: key,
        state: 'uploading',
      },
      ['objectKey'],
    );
    await this.storage.put(key, bytes, contentType);
    await this.dataSource.getRepository(ObjectRegistryEntity).update(
      { objectKey: key },
      { missing: false, state: 'verified' },
    );
  }
}
