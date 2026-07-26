import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { CatalogService } from '../catalog/catalog.service';
import { CategoryEntity, PatternEntity, TagEntity } from '../catalog/entities';
import { catalogPatternObjectKeys } from '../catalog/pattern-object-keys';
import { OBJECT_STORAGE, ObjectStorage } from '../catalog/storage/object-storage.interface';
import { calculatePatternSize } from '../conversion/conversion-profile';
import { readImageDimensions } from '../conversion/image-dimensions';
import { OFFICIAL_PATTERN_DRAFT_EVENT_NAME, OFFICIAL_PATTERN_DRAFT_JOB_TYPE } from '../jobs/jobs.constants';
import type { JsonObject } from '../jobs/jobs.types';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository';
import { ObjectRegistryEntity } from '../sessions/entities';
import { MAX_TAG_CODES_PER_PATTERN, OFFICIAL_PATTERN_DRAFT_MAX_UPLOAD_BYTES } from './admin.constants';
import { OfficialPatternDraftEntity, OfficialPatternDraftStatus } from './entities';
import { OperatorAuditLogService } from './operator-audit-log.service';
import { deriveUnlockPriceTier } from './pattern-price-tier';

export interface UploadedSourceImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface OfficialPatternDraftView {
  id: string;
  status: OfficialPatternDraftStatus;
  shortEdgeCells: number;
  maxColors: number;
  width: number | null;
  height: number | null;
  paletteSize: number | null;
  stitchableCellCount: number | null;
  hasPreview: boolean;
  failureReason: string | null;
  publishedPatternId: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class OfficialPatternDraftsService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly processingJobs: ProcessingJobsRepository,
    private readonly catalogService: CatalogService,
    private readonly auditLog: OperatorAuditLogService,
    @InjectRepository(OfficialPatternDraftEntity)
    private readonly drafts: Repository<OfficialPatternDraftEntity>,
  ) {}

  async createDraft(
    operatorAccountId: string,
    dto: { shortEdgeCells: number; maxColors: number },
    file: UploadedSourceImage | undefined,
    requestId: string | null,
  ): Promise<{ draftId: string; jobId: string }> {
    if (file === undefined || file.size === 0 || file.buffer.length === 0) {
      throw new BadRequestException('A source image upload is required');
    }
    if (
      file.size !== file.buffer.length ||
      file.size > OFFICIAL_PATTERN_DRAFT_MAX_UPLOAD_BYTES
    ) {
      throw new BadRequestException(
        `Source image must be at most ${OFFICIAL_PATTERN_DRAFT_MAX_UPLOAD_BYTES} bytes`,
      );
    }

    let dimensions: ReturnType<typeof readImageDimensions>;
    try {
      dimensions = readImageDimensions(file.buffer);
    } catch (error: unknown) {
      throw new BadRequestException(errorMessage(error));
    }
    if (file.mimetype !== dimensions.contentType) {
      throw new BadRequestException('Source image content type does not match its bytes');
    }

    let size: { width: number; height: number };
    try {
      size = calculatePatternSize(dimensions.width, dimensions.height, dto.shortEdgeCells);
    } catch (error: unknown) {
      throw new BadRequestException(errorMessage(error));
    }
    if (size.width > 300 || size.height > 300) {
      throw new BadRequestException(
        `A ${dto.shortEdgeCells}-cell short edge is unavailable for this image's framing`,
      );
    }

    const draftId = randomUUID();
    const processingJobId = randomUUID();
    const extension = dimensions.contentType === 'image/png' ? 'png' : 'jpg';
    const sourceObjectKey = `official-pattern-drafts/${draftId}/source.${extension}`;
    const checksum = sha256(file.buffer);

    await this.dataSource.getRepository(ObjectRegistryEntity).save({
      byteLength: file.size,
      checksum,
      missing: false,
      objectKey: sourceObjectKey,
      state: 'uploading',
    });
    try {
      await this.storage.put(sourceObjectKey, file.buffer, dimensions.contentType);
      await this.dataSource
        .getRepository(ObjectRegistryEntity)
        .update({ objectKey: sourceObjectKey }, { state: 'verified' });

      await this.dataSource.transaction(async (manager) => {
        const payload: JsonObject = { draftId };
        await this.processingJobs.createPendingWithOutboxFor(manager, {
          eventName: OFFICIAL_PATTERN_DRAFT_EVENT_NAME,
          id: processingJobId,
          payload,
          type: OFFICIAL_PATTERN_DRAFT_JOB_TYPE,
        });
        await manager.getRepository(OfficialPatternDraftEntity).save({
          createdByOperatorId: operatorAccountId,
          id: draftId,
          maxColors: dto.maxColors,
          processingJobId,
          shortEdgeCells: dto.shortEdgeCells,
          sourceByteLength: file.size,
          sourceChecksum: checksum,
          sourceContentType: dimensions.contentType,
          sourceHeight: dimensions.height,
          sourceObjectKey,
          sourceWidth: dimensions.width,
          status: OfficialPatternDraftStatus.Pending,
        });
        await manager
          .getRepository(ObjectRegistryEntity)
          .update({ objectKey: sourceObjectKey }, { state: 'committed' });
        await this.auditLog.record(manager, {
          action: 'pattern_draft.create',
          after: {
            maxColors: dto.maxColors,
            shortEdgeCells: dto.shortEdgeCells,
            sourceObjectKey,
          },
          before: null,
          operatorAccountId,
          outcome: 'success',
          requestId,
          targetId: draftId,
          targetType: 'official_pattern_draft',
        });
      });
    } catch (error: unknown) {
      try {
        await this.storage.delete(sourceObjectKey);
        await this.dataSource
          .getRepository(ObjectRegistryEntity)
          .delete({ objectKey: sourceObjectKey });
      } catch {
        // Keep the uploading registry row so the storage reconciler can retry.
      }
      throw error;
    }

    return { draftId, jobId: processingJobId };
  }

  async listDrafts(options: {
    status?: OfficialPatternDraftStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: OfficialPatternDraftView[]; total: number; page: number; pageSize: number }> {
    const queryBuilder = this.drafts.createQueryBuilder('draft');
    if (options.status !== undefined) {
      queryBuilder.where('draft.status = :status', { status: options.status });
    }
    queryBuilder
      .orderBy('draft.createdAt', 'DESC')
      .addOrderBy('draft.id', 'DESC')
      .skip((options.page - 1) * options.pageSize)
      .take(options.pageSize);

    const [items, total] = await queryBuilder.getManyAndCount();
    return {
      items: items.map((draft) => this.formatView(draft)),
      page: options.page,
      pageSize: options.pageSize,
      total,
    };
  }

  async getDraftById(id: string): Promise<OfficialPatternDraftView> {
    const draft = await this.drafts.findOneBy({ id });
    if (draft === null) {
      throw new NotFoundException(`Official Pattern Draft ${id} was not found`);
    }
    return this.formatView(draft);
  }

  async getPreviewBytes(id: string): Promise<Buffer> {
    const draft = await this.drafts.findOneBy({ id });
    if (draft === null) {
      throw new NotFoundException(`Official Pattern Draft ${id} preview was not found`);
    }
    const previewObjectKey = await this.resolvePreviewObjectKey(draft);
    if (previewObjectKey === null) {
      throw new NotFoundException(`Official Pattern Draft ${id} preview was not found`);
    }
    const bytes = await this.storage.get(previewObjectKey);
    if (bytes === null) {
      throw new NotFoundException(`Official Pattern Draft ${id} preview was not found`);
    }
    return bytes;
  }

  // Publishing copies the preview to a permanent catalog object key and
  // deletes the staged draft-scoped copy, so a published draft's own
  // previewObjectKey no longer resolves — fall back to the Pattern's key.
  private async resolvePreviewObjectKey(draft: OfficialPatternDraftEntity): Promise<string | null> {
    if (draft.status === OfficialPatternDraftStatus.Published && draft.publishedPatternId !== null) {
      const pattern = await this.dataSource
        .getRepository(PatternEntity)
        .findOneBy({ id: draft.publishedPatternId });
      return pattern?.previewObjectKey ?? null;
    }
    return draft.previewObjectKey;
  }

  async publishDraft(
    operatorAccountId: string,
    draftId: string,
    dto: {
      title: string;
      creatorName: string;
      categoryCode: string;
      tagCodes: string[];
      paid: boolean;
    },
    requestId: string | null,
  ): Promise<{ draftId: string; patternId: string; status: 'published' }> {
    if (dto.tagCodes.length > MAX_TAG_CODES_PER_PATTERN) {
      throw new BadRequestException(
        `A pattern can have at most ${MAX_TAG_CODES_PER_PATTERN} tags`,
      );
    }
    const result = await this.dataSource.transaction(async (manager) => {
      const draftRepository = manager.getRepository(OfficialPatternDraftEntity);
      const draft = await draftRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: draftId },
      });
      if (draft === null) {
        throw new NotFoundException(`Official Pattern Draft ${draftId} was not found`);
      }

      if (draft.status === OfficialPatternDraftStatus.Published) {
        if (draft.publishedPatternId === null) {
          throw new Error(`Draft ${draftId} is published but has no linked Pattern`);
        }
        // Already published and staging objects already cleaned up by that
        // earlier call; nothing left to delete on this idempotent replay.
        return {
          draftId: draft.id,
          patternId: draft.publishedPatternId,
          stagedArtifactObjectKey: null,
          stagedPreviewObjectKey: null,
          status: 'published' as const,
        };
      }
      if (draft.status !== OfficialPatternDraftStatus.Ready) {
        throw new BadRequestException(
          `Draft ${draftId} is not ready to publish (status: ${draft.status})`,
        );
      }
      if (
        draft.stitchableCellCount === null ||
        draft.artifactObjectKey === null ||
        draft.previewObjectKey === null ||
        draft.artifactChecksum === null ||
        draft.artifactByteLength === null ||
        draft.artifactSchemaVersion === null ||
        draft.width === null ||
        draft.height === null ||
        draft.paletteSize === null
      ) {
        throw new Error(`Ready draft ${draftId} is missing its conversion result`);
      }

      const categoryRepository = manager.getRepository(CategoryEntity);
      const category = await categoryRepository.findOne({
        where: { active: true, code: dto.categoryCode },
      });
      if (category === null) {
        throw new BadRequestException(`Invalid category code: ${dto.categoryCode}`);
      }

      const tagRepository = manager.getRepository(TagEntity);
      for (const code of dto.tagCodes) {
        const tag = await tagRepository.findOne({ where: { code } });
        if (tag === null) {
          throw new BadRequestException(`Unknown tag code: ${code}`);
        }
      }

      const patternRepository = manager.getRepository(PatternEntity);
      let patternId: string;
      let catalogArtifactKey: string;
      let catalogPreviewKey: string;

      if (draft.publishedPatternId !== null) {
        const existing = await patternRepository.findOneBy({ id: draft.publishedPatternId });
        if (existing === null) {
          throw new Error(
            `Draft ${draftId} references Pattern ${draft.publishedPatternId} which no longer exists`,
          );
        }
        patternId = existing.id;
        catalogArtifactKey = existing.artifactObjectKey;
        catalogPreviewKey = existing.previewObjectKey;
      } else {
        const collision = await patternRepository.findOne({
          where: { creatorName: dto.creatorName, title: dto.title, visibility: 'catalog' },
        });
        if (collision !== null) {
          throw new ConflictException(
            `A catalog Pattern titled "${dto.title}" by "${dto.creatorName}" already exists`,
          );
        }
        patternId = randomUUID();
        const catalogKeys = catalogPatternObjectKeys(patternId);
        catalogArtifactKey = catalogKeys.artifact;
        catalogPreviewKey = catalogKeys.preview;
      }

      const [artifactBytes, previewBytes] = await Promise.all([
        this.storage.get(draft.artifactObjectKey),
        this.storage.get(draft.previewObjectKey),
      ]);
      if (artifactBytes === null || previewBytes === null) {
        throw new Error(`Draft ${draftId} staged artifact/preview objects are missing`);
      }

      await this.storage.put(catalogArtifactKey, artifactBytes, 'application/octet-stream');
      await this.storage.put(catalogPreviewKey, previewBytes, 'image/png');
      await this.registerCatalogObject(
        manager,
        catalogArtifactKey,
        draft.artifactChecksum,
        draft.artifactByteLength,
      );
      await this.registerCatalogObject(
        manager,
        catalogPreviewKey,
        sha256(previewBytes),
        previewBytes.length,
      );

      const unlockPriceTier = deriveUnlockPriceTier(dto.paid, draft.stitchableCellCount);
      const pattern = await this.catalogService.upsertPatternWithManager(
        {
          artifactByteLength: draft.artifactByteLength,
          artifactChecksum: draft.artifactChecksum,
          artifactObjectKey: catalogArtifactKey,
          artifactSchemaVersion: draft.artifactSchemaVersion,
          categoryCode: dto.categoryCode,
          creatorName: dto.creatorName,
          height: draft.height,
          id: patternId,
          paletteSize: draft.paletteSize,
          previewObjectKey: catalogPreviewKey,
          publishedAt: new Date(),
          status: 'available',
          tagCodes: dto.tagCodes,
          title: dto.title,
          unlockPriceTier,
          width: draft.width,
        },
        manager,
      );

      draft.status = OfficialPatternDraftStatus.Published;
      draft.publishedPatternId = pattern.id;
      await draftRepository.save(draft);

      await this.auditLog.record(manager, {
        action: 'pattern_draft.publish',
        after: {
          categoryCode: dto.categoryCode,
          creatorName: dto.creatorName,
          patternId: pattern.id,
          tagCodes: dto.tagCodes,
          title: dto.title,
          unlockPriceTier,
        },
        before: null,
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: draftId,
        targetType: 'official_pattern_draft',
      });

      return {
        draftId: draft.id,
        patternId: pattern.id,
        stagedArtifactObjectKey: draft.artifactObjectKey,
        stagedPreviewObjectKey: draft.previewObjectKey,
        status: 'published' as const,
      };
    });

    // Bytes were copied (not moved) to the new catalog keys above; the
    // staging copies are no longer needed. Best-effort: a leftover staged
    // object is inert and cannot resurface once the draft is published.
    await Promise.allSettled(
      [result.stagedArtifactObjectKey, result.stagedPreviewObjectKey]
        .filter((key): key is string => key !== null)
        .map((key) => this.storage.delete(key)),
    );

    return { draftId: result.draftId, patternId: result.patternId, status: result.status };
  }

  async discardDraft(
    operatorAccountId: string,
    draftId: string,
    requestId: string | null,
  ): Promise<{ draftId: string; status: 'discarded' }> {
    const staged = await this.dataSource.transaction(async (manager) => {
      const draftRepository = manager.getRepository(OfficialPatternDraftEntity);
      const draft = await draftRepository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: draftId },
      });
      if (draft === null) {
        throw new NotFoundException(`Official Pattern Draft ${draftId} was not found`);
      }
      if (draft.status === OfficialPatternDraftStatus.Published) {
        throw new BadRequestException(
          `Draft ${draftId} is already published and cannot be discarded`,
        );
      }
      if (draft.status === OfficialPatternDraftStatus.Discarded) {
        return null; // already discarded: idempotent no-op
      }

      const before = { status: draft.status };
      draft.status = OfficialPatternDraftStatus.Discarded;
      await draftRepository.save(draft);

      await this.auditLog.record(manager, {
        action: 'pattern_draft.discard',
        after: { status: draft.status },
        before,
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: draftId,
        targetType: 'official_pattern_draft',
      });

      return {
        artifactObjectKey: draft.artifactObjectKey,
        previewObjectKey: draft.previewObjectKey,
        sourceObjectKey: draft.sourceObjectKey,
      };
    });

    if (staged !== null) {
      await this.cleanupStagedObjects(staged);
    }
    return { draftId, status: 'discarded' };
  }

  private async registerCatalogObject(
    manager: EntityManager,
    objectKey: string,
    checksum: string,
    byteLength: number,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO "storage"."object_registry" ("object_key", "checksum", "byte_length", "state", "missing")
       VALUES ($1, $2, $3, 'available', false)
       ON CONFLICT ("object_key") DO UPDATE SET "checksum" = EXCLUDED."checksum", "byte_length" = EXCLUDED."byte_length", "state" = 'available', "missing" = false`,
      [objectKey, checksum, byteLength],
    );
  }

  private async cleanupStagedObjects(staged: {
    sourceObjectKey: string;
    artifactObjectKey: string | null;
    previewObjectKey: string | null;
  }): Promise<void> {
    const keys = [staged.sourceObjectKey, staged.artifactObjectKey, staged.previewObjectKey].filter(
      (key): key is string => key !== null,
    );
    await Promise.allSettled(keys.map((key) => this.storage.delete(key)));
    if (keys.length > 0) {
      await this.dataSource
        .getRepository(ObjectRegistryEntity)
        .createQueryBuilder()
        .delete()
        .where('object_key IN (:...keys)', { keys })
        .andWhere("state <> 'available'")
        .execute();
    }
  }

  private formatView(draft: OfficialPatternDraftEntity): OfficialPatternDraftView {
    return {
      createdAt: draft.createdAt.toISOString(),
      failureReason: draft.failureReason,
      hasPreview: draft.previewObjectKey !== null,
      height: draft.height,
      id: draft.id,
      maxColors: draft.maxColors,
      paletteSize: draft.paletteSize,
      publishedPatternId: draft.publishedPatternId,
      shortEdgeCells: draft.shortEdgeCells,
      status: draft.status,
      stitchableCellCount: draft.stitchableCellCount,
      updatedAt: draft.updatedAt.toISOString(),
      width: draft.width,
    };
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
