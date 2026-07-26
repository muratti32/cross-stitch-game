import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';

import { PatternEntity } from '../catalog/entities';
import { encodePatternArtifactV1 } from '../catalog/pattern-artifact-encoder';
import { personalPatternObjectKeys } from '../catalog/pattern-object-keys';
import { OBJECT_STORAGE, ObjectStorage } from '../catalog/storage/object-storage.interface';
import { CONVERSION_JOB_TYPE } from '../jobs/jobs.constants';
import { ProcessingJobStatus } from '../jobs/entities';
import { ProcessingJobNotReadyError } from '../jobs/demo-job-consumer.service';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository';
import type { ProcessingJobQueueResult } from '../jobs/jobs.types';
import { ObjectRegistryEntity } from '../sessions/entities';
import {
  ConversionEngineClient,
  ConversionEngineRequestError,
  ConversionEngineResponse,
} from './conversion-engine.client';
import { calculatePatternSize } from './conversion-profile';
import {
  ConversionRecipeEntity,
  PatternConversionEntity,
  PersonalPatternEntity,
} from './entities';

class TerminalConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = TerminalConversionError.name;
  }
}

@Injectable()
export class ConversionJobConsumerService {
  private readonly logger = new Logger(ConversionJobConsumerService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly engine: ConversionEngineClient,
    private readonly processingJobs: ProcessingJobsRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async processDelivery(
    processingJobId: string,
  ): Promise<ProcessingJobQueueResult> {
    const claim = await this.processingJobs.claimForWorker(processingJobId);
    if (claim.kind === 'missing') {
      throw new Error(`Missing Pattern Conversion job ${processingJobId}`);
    }
    if (claim.kind === 'retry') {
      throw new ProcessingJobNotReadyError(processingJobId);
    }

    const conversion = await this.dataSource
      .getRepository(PatternConversionEntity)
      .findOneBy({ processingJobId });
    if (conversion === null || claim.job.type !== CONVERSION_JOB_TYPE) {
      throw new TerminalConversionError(
        `Pattern Conversion input ${processingJobId} is missing`,
      );
    }
    if (claim.kind === 'terminal') {
      await this.deleteTemporaryUpload(conversion);
      return { outcome: 'terminal-replay', processingJobId };
    }

    try {
      const artwork = await this.storage.get(conversion.uploadObjectKey);
      if (artwork === null || sha256(artwork) !== conversion.uploadChecksum.trim()) {
        throw new TerminalConversionError(
          'The temporary Conversion Upload is missing or corrupt',
        );
      }
      const engineResult = await this.engine.convert({
        artwork,
        contentType: conversion.uploadContentType,
        maxColors: conversion.maxColors,
        shortEdgeCells: conversion.shortEdgeCells,
      });
      const result = await this.persistResult(conversion, engineResult);
      await this.deleteTemporaryUpload(conversion);
      return {
        outcome: claim.kind === 'resume' ? 'resumed-and-completed' : 'completed',
        processingJobId: result.processingJobId,
      };
    } catch (error: unknown) {
      if (
        error instanceof TerminalConversionError ||
        (error instanceof ConversionEngineRequestError && !error.retryable)
      ) {
        await this.failAndCleanup(conversion, errorMessage(error));
      }
      throw asError(error);
    }
  }

  async failExhausted(processingJobId: string, reason: string): Promise<void> {
    const conversion = await this.dataSource
      .getRepository(PatternConversionEntity)
      .findOneBy({ processingJobId });
    if (conversion === null) {
      return;
    }
    const job = await this.processingJobs.findById(processingJobId);
    if (job?.status === ProcessingJobStatus.Running) {
      await this.processingJobs.failFromRunning(processingJobId, reason);
    }
    await this.cleanupUncommittedObjects(conversion);
  }

  private async persistResult(
    conversion: PatternConversionEntity,
    response: ConversionEngineResponse,
  ): Promise<{ processingJobId: string }> {
    const expectedSize = calculatePatternSize(
      conversion.framedWidth,
      conversion.framedHeight,
      conversion.shortEdgeCells,
    );
    const width = response.statistics.width;
    const height = response.statistics.height;
    if (width !== expectedSize.width || height !== expectedSize.height) {
      throw new TerminalConversionError(
        `Conversion Engine returned unexpected Pattern Size ${width}x${height}`,
      );
    }
    if (
      response.palette.length > conversion.maxColors ||
      response.statistics.distinct_colors !== response.palette.length
    ) {
      throw new TerminalConversionError(
        'Conversion Engine returned an invalid DMC palette',
      );
    }

    const grid = decodeBase64(response.grid, 'grid');
    if (grid.length !== width * height) {
      throw new TerminalConversionError(
        'Conversion Engine grid length does not match Pattern Size',
      );
    }
    for (const paletteIndex of grid) {
      if (paletteIndex > response.palette.length) {
        throw new TerminalConversionError(
          'Conversion Engine grid references an unknown palette entry',
        );
      }
    }
    const preview = decodeBase64(response.preview_png, 'preview');
    if (!preview.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new TerminalConversionError('Conversion Engine preview is not PNG');
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
    const { artifact: artifactKey, preview: previewKey } = personalPatternObjectKeys(
      conversion.targetPatternId,
    );
    await Promise.all([
      this.stageObject(artifactKey, artifact.bytes, 'application/octet-stream'),
      this.stageObject(previewKey, preview, 'image/png'),
    ]);

    const result = {
      artifactChecksum: artifact.checksum,
      patternId: conversion.targetPatternId,
    };
    await this.dataSource.transaction(async (manager) => {
      const existing = await manager.getRepository(PersonalPatternEntity).findOneBy({
        processingJobId: conversion.processingJobId,
      });
      if (existing === null) {
        await manager.getRepository(PatternEntity).save({
          artifactByteLength: artifact.byteLength,
          artifactChecksum: artifact.checksum,
          artifactObjectKey: artifactKey,
          artifactSchemaVersion: artifact.schemaVersion,
          categoryCode: 'other',
          creatorName: 'You',
          height,
          id: conversion.targetPatternId,
          ownerAccountId: conversion.accountId,
          paletteSize: response.palette.length,
          previewObjectKey: previewKey,
          publishedAt: new Date(),
          status: 'available',
          title: conversion.title,
          unlockPriceTier: null,
          visibility: 'personal',
          width,
        });
        await manager.getRepository(PersonalPatternEntity).save({
          ownerAccountId: conversion.accountId,
          patternId: conversion.targetPatternId,
          processingJobId: conversion.processingJobId,
        });
        await manager.getRepository(ConversionRecipeEntity).save({
          dmcPaletteVersion: response.dmc_palette_version,
          engineVersion: response.engine_version,
          height,
          maxColors: conversion.maxColors,
          patternId: conversion.targetPatternId,
          profile: conversion.profile,
          recipeVersion: response.recipe_version,
          shortEdgeCells: conversion.shortEdgeCells,
          width,
        });
      }
      await manager.getRepository(ObjectRegistryEntity).update(
        [{ objectKey: artifactKey }, { objectKey: previewKey }],
        { missing: false, state: 'available' },
      );
      const completed = await this.processingJobs.completeFromRunning(
        conversion.processingJobId,
        result,
        manager,
      );
      if (!completed) {
        const current = await this.processingJobs.findById(
          conversion.processingJobId,
          manager,
        );
        if (current?.status !== ProcessingJobStatus.Completed) {
          throw new Error('Pattern Conversion lost its running state');
        }
      }
    });
    return { processingJobId: conversion.processingJobId };
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

  private async failAndCleanup(
    conversion: PatternConversionEntity,
    reason: string,
  ): Promise<void> {
    await this.processingJobs.failFromRunning(
      conversion.processingJobId,
      reason,
    );
    await this.cleanupUncommittedObjects(conversion);
  }

  private async deleteTemporaryUpload(
    conversion: PatternConversionEntity,
  ): Promise<void> {
    try {
      await this.dataSource.getRepository(ObjectRegistryEntity).update(
        { objectKey: conversion.uploadObjectKey },
        { state: 'uploading' },
      );
      await this.storage.delete(conversion.uploadObjectKey);
      await this.dataSource
        .getRepository(ObjectRegistryEntity)
        .delete({ objectKey: conversion.uploadObjectKey });
    } catch (error: unknown) {
      this.logger.error(
        `Could not delete Conversion Upload for job ${conversion.processingJobId}: ${errorMessage(error)}`,
      );
    }
  }

  private async cleanupUncommittedObjects(
    conversion: PatternConversionEntity,
  ): Promise<void> {
    const committed = await this.dataSource
      .getRepository(PersonalPatternEntity)
      .findOneBy({ processingJobId: conversion.processingJobId });
    if (committed !== null) {
      await this.deleteTemporaryUpload(conversion);
      return;
    }
    const { all: keys } = personalPatternObjectKeys(conversion.targetPatternId);
    await this.deleteTemporaryUpload(conversion);
    await Promise.allSettled(keys.map((key) => this.storage.delete(key)));
    await this.dataSource
      .getRepository(ObjectRegistryEntity)
      .createQueryBuilder()
      .delete()
      .where('object_key IN (:...keys)', { keys })
      .andWhere('state <> :state', { state: 'available' })
      .execute();
  }
}

function decodeBase64(value: string, label: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TerminalConversionError(`Conversion Engine ${label} is not valid base64`);
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
