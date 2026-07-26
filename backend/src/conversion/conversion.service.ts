import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';

import { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { PatternEntity } from '../catalog/entities';
import { personalPatternObjectKeys } from '../catalog/pattern-object-keys';
import { OBJECT_STORAGE, ObjectStorage } from '../catalog/storage/object-storage.interface';
import { AppConfigService } from '../config/app-config.service';
import {
  CONVERSION_JOB_EVENT_NAME,
  CONVERSION_JOB_TYPE,
} from '../jobs/jobs.constants';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository';
import type { JsonObject } from '../jobs/jobs.types';
import { ProcessingJobEntity, ProcessingJobStatus } from '../jobs/entities';
import { CreatePhotoConversionDto } from './dto/create-photo-conversion.dto';
import { CreateDerivedPatternDto } from './dto/create-derived-pattern.dto';
import { renderPatternPreviewPng } from './pattern-preview-renderer';
import { PatternThumbnailStagingService } from './pattern-thumbnail-staging.service';
import { encodePatternArtifactV1 } from '../catalog/pattern-artifact-encoder';
import {
  ConversionRecipeEntity,
  PatternConversionEntity,
  PersonalPatternEntity,
} from './entities';
import { readImageDimensions } from './image-dimensions';
import { resolveConversionSettings } from './conversion-profile';
import { ObjectRegistryEntity } from '../sessions/entities';
import { SupportReferenceService } from '../support/support-reference.service';

export interface UploadedArtwork {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Injectable()
export class ConversionService {
  constructor(
    private readonly config: AppConfigService,
    private readonly dataSource: DataSource,
    private readonly processingJobs: ProcessingJobsRepository,
    private readonly supportReferences: SupportReferenceService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @InjectRepository(PatternConversionEntity)
    private readonly conversions: Repository<PatternConversionEntity>,
    @InjectRepository(PersonalPatternEntity)
    private readonly personalPatterns: Repository<PersonalPatternEntity>,
    @InjectRepository(ConversionRecipeEntity)
    private readonly recipes: Repository<ConversionRecipeEntity>,
    @InjectRepository(PatternEntity)
    private readonly patterns: Repository<PatternEntity>,
    private readonly thumbnails: PatternThumbnailStagingService,
  ) {}

  async createPhotoConversion(
    principal: AuthPrincipal,
    dto: CreatePhotoConversionDto,
    artwork: UploadedArtwork | undefined,
  ): Promise<{ id: string; status: 'pending'; supportReference: string }> {
    const accountId = this.requireAccount(principal);
    if (artwork === undefined || artwork.size === 0 || artwork.buffer.length === 0) {
      throw new BadRequestException('A framed artwork upload is required');
    }
    if (artwork.size !== artwork.buffer.length || artwork.size > 20 * 1024 * 1024) {
      throw new BadRequestException('Artwork upload size is invalid');
    }

    let dimensions: ReturnType<typeof readImageDimensions>;
    try {
      dimensions = readImageDimensions(artwork.buffer);
    } catch (error: unknown) {
      throw new BadRequestException(errorMessage(error));
    }
    if (artwork.mimetype !== dimensions.contentType) {
      throw new BadRequestException('Artwork content type does not match its bytes');
    }

    let settings: ReturnType<typeof resolveConversionSettings>;
    try {
      settings = resolveConversionSettings({
        customMaxColors: dto.maxColors,
        customShortEdgeCells: dto.shortEdgeCells,
        profile: dto.profile,
        sourceHeight: dimensions.height,
        sourceWidth: dimensions.width,
      });
    } catch (error: unknown) {
      throw new BadRequestException(errorMessage(error));
    }

    const title = dto.title.trim();
    if (title.length === 0) {
      throw new BadRequestException('Pattern title cannot be blank');
    }
    await this.assertTitleAvailable(accountId, title);

    const processingJobId = randomUUID();
    const targetPatternId = randomUUID();
    const extension = dimensions.contentType === 'image/png' ? 'png' : 'jpg';
    const uploadObjectKey = `conversion-uploads/${processingJobId}.${extension}`;
    const uploadChecksum = sha256(artwork.buffer);

    let supportReference: string;
    await this.dataSource.getRepository(ObjectRegistryEntity).save({
      byteLength: artwork.size,
      checksum: uploadChecksum,
      missing: false,
      objectKey: uploadObjectKey,
      state: 'uploading',
    });
    try {
      await this.storage.put(
        uploadObjectKey,
        artwork.buffer,
        dimensions.contentType,
      );
      await this.dataSource.getRepository(ObjectRegistryEntity).update(
        { objectKey: uploadObjectKey },
        { state: 'verified' },
      );
      supportReference = await this.dataSource.transaction(async (manager) => {
        const payload: JsonObject = { conversionId: processingJobId };
        await this.processingJobs.createPendingWithOutboxFor(manager, {
          eventName: CONVERSION_JOB_EVENT_NAME,
          id: processingJobId,
          payload,
          type: CONVERSION_JOB_TYPE,
        });
        await manager.getRepository(PatternConversionEntity).save({
          accountId,
          framedHeight: dimensions.height,
          framedWidth: dimensions.width,
          maxColors: settings.maxColors,
          processingJobId,
          profile: dto.profile,
          shortEdgeCells: settings.shortEdgeCells,
          targetPatternId,
          title,
          uploadByteLength: artwork.size,
          uploadChecksum,
          uploadContentType: dimensions.contentType,
          uploadObjectKey,
        });
        await manager.getRepository(ObjectRegistryEntity).update(
          { objectKey: uploadObjectKey },
          { state: 'committed' },
        );
        return this.supportReferences.create(manager, {
          principalId: accountId,
          principalType: 'account',
          records: [
            { id: processingJobId, type: 'processing_job' },
            { id: processingJobId, type: 'pattern_conversion' },
          ],
        });
      });
    } catch (error: unknown) {
      try {
        await this.storage.delete(uploadObjectKey);
        await this.dataSource
          .getRepository(ObjectRegistryEntity)
          .delete({ objectKey: uploadObjectKey });
      } catch {
        // Keep the uploading registry row so the storage reconciler can retry.
      }
      throw error;
    }

    return { id: processingJobId, status: 'pending', supportReference };
  }

  async getConversionJob(principal: AuthPrincipal, id: string) {
    const accountId = this.requireAccount(principal);
    const conversion = await this.conversions.findOneBy({ processingJobId: id });
    if (conversion === null || conversion.accountId !== accountId) {
      throw new NotFoundException('Pattern Conversion not found');
    }
    const job = await this.processingJobs.findById(id);
    if (job === null || job.type !== CONVERSION_JOB_TYPE) {
      throw new NotFoundException('Pattern Conversion not found');
    }

    return {
      createdAt: job.createdAt.toISOString(),
      errorMessage: job.errorMessage,
      id: job.id,
      pattern:
        job.status === ProcessingJobStatus.Completed
          ? await this.getPersonalPattern(accountId, conversion.targetPatternId)
          : null,
      status: job.status,
      updatedAt: job.updatedAt.toISOString(),
    };
  }

  async createDerivedPattern(
    principal: AuthPrincipal,
    dto: CreateDerivedPatternDto,
  ): Promise<{
    id: string;
    title: string;
    width: number;
    height: number;
    previewUrl: string;
    alreadyExists: boolean;
  }> {
    const accountId = this.requireAccount(principal);

    // 2. Idempotent replay short-circuit
    const existing = await this.patterns.findOneBy({ id: dto.patternId });
    if (existing !== null) {
      if (existing.ownerAccountId !== accountId || existing.visibility !== 'personal') {
        throw new ConflictException('This identifier is already in use');
      }
      const exp = Math.floor(Date.now() / 1000) + this.config.grantTtlSeconds;
      const signature = this.signPreviewGrant(existing.id, exp);
      return {
        id: existing.id,
        title: existing.title,
        width: existing.width,
        height: existing.height,
        previewUrl: `/v1/personal-pattern-previews/${existing.id}?exp=${exp}&sig=${signature}`,
        alreadyExists: true,
      };
    }

    // 3. Validate source
    const sourcePersonal = await this.personalPatterns.findOneBy({
      patternId: dto.sourcePatternId,
      ownerAccountId: accountId,
    });
    if (sourcePersonal === null) {
      throw new NotFoundException('Source Personal Pattern not found');
    }

    // 4. Validate title
    const title = dto.title.trim();
    if (title.length === 0) {
      throw new BadRequestException('Pattern title cannot be blank');
    }
    await this.assertTitleAvailable(accountId, title);

    // 5. Decode grid
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dto.grid)) {
      throw new BadRequestException('Grid is not valid base64');
    }
    const grid = Buffer.from(dto.grid, 'base64');
    if (grid.length !== dto.width * dto.height) {
      throw new BadRequestException(
        `Grid length ${grid.length} does not match dimensions ${dto.width}x${dto.height}`,
      );
    }

    // 6 & 7. Encode artifact + render preview
    let artifact: ReturnType<typeof encodePatternArtifactV1>;
    let preview: Buffer;
    try {
      artifact = encodePatternArtifactV1({
        width: dto.width,
        height: dto.height,
        palette: dto.palette,
        grid,
      });
      preview = renderPatternPreviewPng({
        width: dto.width,
        height: dto.height,
        palette: dto.palette,
        grid,
      });
    } catch (error: unknown) {
      throw new BadRequestException(error instanceof Error ? error.message : String(error));
    }

    // 8. Stage to R2 & register in ObjectRegistryEntity
    const { artifact: artifactKey, preview: previewKey } = personalPatternObjectKeys(
      dto.patternId,
    );
    const artifactChecksum = artifact.checksum;
    const previewChecksum = sha256(preview);

    const registryRepo = this.dataSource.getRepository(ObjectRegistryEntity);

    // Stage artifact
    await registryRepo.upsert(
      {
        byteLength: artifact.byteLength,
        checksum: artifactChecksum,
        missing: false,
        objectKey: artifactKey,
        state: 'uploading',
      },
      ['objectKey'],
    );
    await this.storage.put(artifactKey, artifact.bytes, 'application/octet-stream');
    await registryRepo.update(
      { objectKey: artifactKey },
      { missing: false, state: 'verified' },
    );

    // Stage preview
    await registryRepo.upsert(
      {
        byteLength: preview.length,
        checksum: previewChecksum,
        missing: false,
        objectKey: previewKey,
        state: 'uploading',
      },
      ['objectKey'],
    );
    await this.storage.put(previewKey, preview, 'image/png');
    await registryRepo.update(
      { objectKey: previewKey },
      { missing: false, state: 'verified' },
    );

    const thumbnails = await this.thumbnails.stagePersonalPatternThumbnails({
      grid,
      height: dto.height,
      palette: dto.palette,
      patternId: dto.patternId,
      width: dto.width,
    });

    // 9. Database transaction
    await this.dataSource.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .insert()
        .into(PatternEntity)
        .values({
          id: dto.patternId,
          title,
          creatorName: 'You',
          categoryCode: 'other',
          width: dto.width,
          height: dto.height,
          paletteSize: dto.palette.length,
          artifactObjectKey: artifactKey,
          artifactChecksum,
          artifactByteLength: artifact.byteLength,
          artifactSchemaVersion: artifact.schemaVersion,
          previewObjectKey: previewKey,
          thumbnailRendererVersion: thumbnails?.version ?? null,
          unlockPriceTier: null,
          status: 'available',
          visibility: 'personal',
          ownerAccountId: accountId,
          publishedAt: new Date(),
        })
        .orIgnore()
        .execute();

      await manager
        .createQueryBuilder()
        .insert()
        .into(PersonalPatternEntity)
        .values({
          patternId: dto.patternId,
          ownerAccountId: accountId,
          processingJobId: null,
          derivedFromPatternId: dto.sourcePatternId,
        })
        .orIgnore()
        .execute();

      await manager.getRepository(ObjectRegistryEntity).update(
        [artifactKey, previewKey, ...(thumbnails?.keys ?? [])].map((objectKey) => ({ objectKey })),
        { missing: false, state: 'available' },
      );
    });

    // 10. Build and return response
    const exp = Math.floor(Date.now() / 1000) + this.config.grantTtlSeconds;
    const signature = this.signPreviewGrant(dto.patternId, exp);
    return {
      id: dto.patternId,
      title,
      width: dto.width,
      height: dto.height,
      previewUrl: `/v1/personal-pattern-previews/${dto.patternId}?exp=${exp}&sig=${signature}`,
      alreadyExists: false,
    };
  }

  async listPersonalPatterns(principal: AuthPrincipal) {
    const accountId = this.requireAccount(principal);
    const rows = await this.personalPatterns.find({
      order: { createdAt: 'DESC' },
      where: { ownerAccountId: accountId },
    });
    return Promise.all(
      rows.map((row) => this.getPersonalPattern(accountId, row.patternId)),
    );
  }

  async getSignedPreview(
    patternId: string,
    exp: number,
    signature: string,
  ): Promise<Buffer> {
    if (!this.verifyPreviewGrant(patternId, exp, signature)) {
      throw new ForbiddenException('Invalid or expired preview grant');
    }
    const pattern = await this.patterns.findOneBy({
      id: patternId,
      visibility: 'personal',
    });
    if (pattern === null) {
      throw new NotFoundException('Personal Pattern preview not found');
    }
    const bytes = await this.storage.get(pattern.previewObjectKey);
    if (bytes === null) {
      throw new NotFoundException('Personal Pattern preview not found');
    }
    return bytes;
  }

  async getPersonalPatternArtifactGrant(principal: AuthPrincipal, patternId: string) {
    const accountId = this.requireAccount(principal);
    const pattern = await this.patterns.findOneBy({
      id: patternId,
      ownerAccountId: accountId,
      visibility: 'personal',
    });
    if (pattern === null) {
      throw new NotFoundException('Personal Pattern not found');
    }
    const exp = Math.floor(Date.now() / 1000) + this.config.grantTtlSeconds;
    const signature = this.signPreviewGrant(pattern.id, exp);
    return {
      artifactUrl: `/v1/personal-pattern-artifacts/${pattern.id}?exp=${exp}&sig=${signature}`,
      checksum: pattern.artifactChecksum,
      byteLength: pattern.artifactByteLength,
      schemaVersion: pattern.artifactSchemaVersion,
      width: pattern.width,
      height: pattern.height,
      title: pattern.title,
    };
  }

  async getSignedArtifact(
    patternId: string,
    exp: number,
    signature: string,
  ): Promise<Buffer> {
    if (!this.verifyPreviewGrant(patternId, exp, signature)) {
      throw new ForbiddenException('Invalid or expired artifact grant');
    }
    const pattern = await this.patterns.findOneBy({
      id: patternId,
      visibility: 'personal',
    });
    if (pattern === null) {
      throw new NotFoundException('Personal Pattern artifact not found');
    }
    const bytes = await this.storage.get(pattern.artifactObjectKey);
    if (bytes === null) {
      throw new NotFoundException('Personal Pattern artifact not found');
    }
    return bytes;
  }

  private async getPersonalPattern(accountId: string, patternId: string) {
    const [pattern, recipe] = await Promise.all([
      this.patterns.findOneBy({
        id: patternId,
        ownerAccountId: accountId,
        visibility: 'personal',
      }),
      this.recipes.findOneBy({ patternId }),
    ]);
    if (pattern === null) {
      throw new NotFoundException('Personal Pattern not found');
    }
    const exp = Math.floor(Date.now() / 1000) + this.config.grantTtlSeconds;
    const signature = this.signPreviewGrant(pattern.id, exp);
    return {
      createdAt: pattern.createdAt.toISOString(),
      height: pattern.height,
      id: pattern.id,
      paletteSize: pattern.paletteSize,
      previewUrl: `/v1/personal-pattern-previews/${pattern.id}?exp=${exp}&sig=${signature}`,
      recipe: recipe === null ? null : {
        dmcPaletteVersion: recipe.dmcPaletteVersion,
        engineVersion: recipe.engineVersion,
        height: recipe.height,
        maxColors: recipe.maxColors,
        profile: recipe.profile,
        recipeVersion: recipe.recipeVersion,
        shortEdgeCells: recipe.shortEdgeCells,
        width: recipe.width,
      },
      title: pattern.title,
      width: pattern.width,
    };
  }

  private async assertTitleAvailable(
    accountId: string,
    title: string,
  ): Promise<void> {
    const existingPattern = await this.patterns
      .createQueryBuilder('pattern')
      .where('pattern.ownerAccountId = :accountId', { accountId })
      .andWhere("pattern.visibility = 'personal'")
      .andWhere('LOWER(pattern.title) = LOWER(:title)', { title })
      .getOne();
    if (existingPattern !== null) {
      throw new ConflictException(
        `You already have a Personal Pattern named "${title}". Choose a different title.`,
      );
    }
    const activeConversion = await this.conversions
      .createQueryBuilder('conversion')
      .innerJoin(
        ProcessingJobEntity,
        'job',
        'job.id = conversion.processingJobId',
      )
      .where('conversion.accountId = :accountId', { accountId })
      .andWhere('LOWER(conversion.title) = LOWER(:title)', { title })
      .andWhere('job.status IN (:...activeStatuses)', {
        activeStatuses: [
          ProcessingJobStatus.Pending,
          ProcessingJobStatus.Dispatched,
          ProcessingJobStatus.Running,
        ],
      })
      .getOne();
    if (activeConversion !== null) {
      throw new ConflictException(
        `A conversion named "${title}" is already in progress. Choose a different title.`,
      );
    }
  }

  private requireAccount(principal: AuthPrincipal): string {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('A Registered Account is required');
    }
    return principal.id;
  }

  private signPreviewGrant(patternId: string, exp: number): string {
    return createHmac('sha256', this.config.grantSigningSecret)
      .update(`personal-preview:${patternId}:${exp}`)
      .digest('hex');
  }

  private verifyPreviewGrant(
    patternId: string,
    exp: number,
    signature: string,
  ): boolean {
    if (!Number.isSafeInteger(exp) || exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    const expected = this.signPreviewGrant(patternId, exp);
    if (!/^[a-f0-9]{64}$/.test(signature)) {
      return false;
    }
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
