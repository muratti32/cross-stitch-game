import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';

import { encodePatternArtifactV1 } from '../catalog/pattern-artifact-encoder';
import { OBJECT_STORAGE, ObjectStorage } from '../catalog/storage/object-storage.interface';
import {
  ConversionEngineClient,
  ConversionEngineRequestError,
  ConversionEngineResponse,
} from '../conversion/conversion-engine.client';
import { calculatePatternSize } from '../conversion/conversion-profile';
import { OFFICIAL_PATTERN_DRAFT_JOB_TYPE } from '../jobs/jobs.constants';
import { ProcessingJobStatus } from '../jobs/entities';
import { ProcessingJobNotReadyError } from '../jobs/demo-job-consumer.service';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository';
import type { ProcessingJobQueueResult } from '../jobs/jobs.types';
import { ObjectRegistryEntity } from '../sessions/entities';
import { OfficialPatternDraftEntity, OfficialPatternDraftStatus } from './entities';

class TerminalDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = TerminalDraftError.name;
  }
}

@Injectable()
export class OfficialPatternDraftJobConsumerService {
  private readonly logger = new Logger(OfficialPatternDraftJobConsumerService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly engine: ConversionEngineClient,
    private readonly processingJobs: ProcessingJobsRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async processDelivery(processingJobId: string): Promise<ProcessingJobQueueResult> {
    const claim = await this.processingJobs.claimForWorker(processingJobId);
    if (claim.kind === 'missing') {
      throw new Error(`Missing Official Pattern Draft job ${processingJobId}`);
    }
    if (claim.kind === 'retry') {
      throw new ProcessingJobNotReadyError(processingJobId);
    }

    const draftRepository = this.dataSource.getRepository(OfficialPatternDraftEntity);
    const draft = await draftRepository.findOneBy({ processingJobId });
    if (draft === null || claim.job.type !== OFFICIAL_PATTERN_DRAFT_JOB_TYPE) {
      throw new TerminalDraftError(
        `Official Pattern Draft input ${processingJobId} is missing`,
      );
    }
    if (claim.kind === 'terminal') {
      return { outcome: 'terminal-replay', processingJobId };
    }

    if (draft.status === OfficialPatternDraftStatus.Pending) {
      await draftRepository.update(
        { id: draft.id },
        { status: OfficialPatternDraftStatus.Processing },
      );
    }

    try {
      const source = await this.storage.get(draft.sourceObjectKey);
      if (source === null || sha256(source) !== draft.sourceChecksum.trim()) {
        throw new TerminalDraftError(
          'The staged Official Pattern Draft source image is missing or corrupt',
        );
      }

      const engineResult = await this.engine.convert({
        artwork: source,
        contentType: draft.sourceContentType,
        maxColors: draft.maxColors,
        shortEdgeCells: draft.shortEdgeCells,
      });

      const result = await this.persistResult(draft, engineResult);
      await this.deleteSourceUpload(draft);
      return {
        outcome: claim.kind === 'resume' ? 'resumed-and-completed' : 'completed',
        processingJobId: result.processingJobId,
      };
    } catch (error: unknown) {
      if (
        error instanceof TerminalDraftError ||
        (error instanceof ConversionEngineRequestError && !error.retryable)
      ) {
        await this.failAndCleanup(draft, errorMessage(error));
      }
      throw asError(error);
    }
  }

  async failExhausted(processingJobId: string, reason: string): Promise<void> {
    const draft = await this.dataSource
      .getRepository(OfficialPatternDraftEntity)
      .findOneBy({ processingJobId });
    if (draft === null) {
      return;
    }
    const job = await this.processingJobs.findById(processingJobId);
    if (job?.status === ProcessingJobStatus.Running) {
      await this.processingJobs.failFromRunning(processingJobId, reason);
    }
    await this.markFailed(draft, reason);
    await this.cleanupUncommittedObjects(draft);
  }

  private async persistResult(
    draft: OfficialPatternDraftEntity,
    response: ConversionEngineResponse,
  ): Promise<{ processingJobId: string }> {
    const expectedSize = calculatePatternSize(
      draft.sourceWidth,
      draft.sourceHeight,
      draft.shortEdgeCells,
    );
    const width = response.statistics.width;
    const height = response.statistics.height;
    if (width !== expectedSize.width || height !== expectedSize.height) {
      throw new TerminalDraftError(
        `Conversion Engine returned unexpected Pattern Size ${width}x${height}`,
      );
    }
    if (
      response.palette.length > draft.maxColors ||
      response.statistics.distinct_colors !== response.palette.length
    ) {
      throw new TerminalDraftError('Conversion Engine returned an invalid DMC palette');
    }

    const grid = decodeBase64(response.grid, 'grid');
    if (grid.length !== width * height) {
      throw new TerminalDraftError('Conversion Engine grid length does not match Pattern Size');
    }
    for (const paletteIndex of grid) {
      if (paletteIndex > response.palette.length) {
        throw new TerminalDraftError(
          'Conversion Engine grid references an unknown palette entry',
        );
      }
    }
    const preview = decodeBase64(response.preview_png, 'preview');
    if (!preview.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new TerminalDraftError('Conversion Engine preview is not PNG');
    }

    const artifact = encodePatternArtifactV1({
      grid,
      height,
      palette: response.palette.map((entry) => ({
        dmcCode: entry.dmc_code,
        name: entry.name,
        rgbHex: entry.rgb_hex,
      })),
      width,
    });
    const artifactKey = this.artifactKey(draft.id);
    const previewKey = this.previewKey(draft.id);
    await Promise.all([
      this.stageObject(artifactKey, artifact.bytes, 'application/octet-stream'),
      this.stageObject(previewKey, preview, 'image/png'),
    ]);

    await this.dataSource.transaction(async (manager) => {
      const draftRepository = manager.getRepository(OfficialPatternDraftEntity);
      const current = await draftRepository.findOneBy({ id: draft.id });
      if (current === null) {
        throw new Error(`Official Pattern Draft ${draft.id} disappeared mid-processing`);
      }
      if (current.status !== OfficialPatternDraftStatus.Discarded) {
        current.status = OfficialPatternDraftStatus.Ready;
      }
      current.artifactByteLength = artifact.byteLength;
      current.artifactChecksum = artifact.checksum;
      current.artifactObjectKey = artifactKey;
      current.artifactSchemaVersion = artifact.schemaVersion;
      current.height = height;
      current.paletteSize = response.palette.length;
      current.previewObjectKey = previewKey;
      current.stitchableCellCount = response.statistics.total_stitchable_cells;
      current.width = width;
      await draftRepository.save(current);

      await manager.getRepository(ObjectRegistryEntity).update(
        [{ objectKey: artifactKey }, { objectKey: previewKey }],
        { missing: false, state: 'available' },
      );
      const completed = await this.processingJobs.completeFromRunning(
        draft.processingJobId as string,
        { draftId: draft.id },
        manager,
      );
      if (!completed) {
        const currentJob = await this.processingJobs.findById(
          draft.processingJobId as string,
          manager,
        );
        if (currentJob?.status !== ProcessingJobStatus.Completed) {
          throw new Error('Official Pattern Draft job lost its running state');
        }
      }
    });

    return { processingJobId: draft.processingJobId as string };
  }

  private async stageObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const checksum = sha256(bytes);
    await this.dataSource.getRepository(ObjectRegistryEntity).upsert(
      { byteLength: bytes.length, checksum, missing: false, objectKey: key, state: 'uploading' },
      ['objectKey'],
    );
    await this.storage.put(key, bytes, contentType);
    await this.dataSource
      .getRepository(ObjectRegistryEntity)
      .update({ objectKey: key }, { missing: false, state: 'verified' });
  }

  private async failAndCleanup(
    draft: OfficialPatternDraftEntity,
    reason: string,
  ): Promise<void> {
    await this.processingJobs.failFromRunning(draft.processingJobId as string, reason);
    await this.markFailed(draft, reason);
    await this.cleanupUncommittedObjects(draft);
  }

  private async markFailed(draft: OfficialPatternDraftEntity, reason: string): Promise<void> {
    await this.dataSource.getRepository(OfficialPatternDraftEntity).update(
      { id: draft.id },
      {
        failureReason: reason,
        status:
          draft.status === OfficialPatternDraftStatus.Discarded
            ? OfficialPatternDraftStatus.Discarded
            : OfficialPatternDraftStatus.Failed,
      },
    );
  }

  private async deleteSourceUpload(draft: OfficialPatternDraftEntity): Promise<void> {
    try {
      await this.storage.delete(draft.sourceObjectKey);
      await this.dataSource
        .getRepository(ObjectRegistryEntity)
        .delete({ objectKey: draft.sourceObjectKey });
    } catch (error: unknown) {
      this.logger.error(
        `Could not delete Official Pattern Draft source upload for ${draft.id}: ${errorMessage(error)}`,
      );
    }
  }

  private async cleanupUncommittedObjects(draft: OfficialPatternDraftEntity): Promise<void> {
    const current = await this.dataSource
      .getRepository(OfficialPatternDraftEntity)
      .findOneBy({ id: draft.id });
    const artifactKey = this.artifactKey(draft.id);
    const previewKey = this.previewKey(draft.id);
    await this.deleteSourceUpload(draft);
    if (current?.status === OfficialPatternDraftStatus.Published) {
      return; // artifact/preview were promoted to catalog keys; nothing staged to clean up.
    }
    await Promise.allSettled([
      this.storage.delete(artifactKey),
      this.storage.delete(previewKey),
    ]);
    await this.dataSource
      .getRepository(ObjectRegistryEntity)
      .createQueryBuilder()
      .delete()
      .where('object_key IN (:...keys)', { keys: [artifactKey, previewKey] })
      .andWhere("state <> 'available'")
      .execute();
  }

  private artifactKey(draftId: string): string {
    return `official-pattern-drafts/${draftId}/artifact-v1.bin`;
  }

  private previewKey(draftId: string): string {
    return `official-pattern-drafts/${draftId}/preview.png`;
  }
}

function decodeBase64(value: string, label: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TerminalDraftError(`Conversion Engine ${label} is not valid base64`);
  }
  return Buffer.from(value, 'base64');
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
