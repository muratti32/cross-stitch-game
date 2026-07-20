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
import {
  ConversionRecipeEntity,
  PatternConversionEntity,
  PersonalPatternEntity,
} from './entities';
import { readImageDimensions } from './image-dimensions';
import { resolveConversionSettings } from './conversion-profile';
import { ObjectRegistryEntity } from '../sessions/entities';

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
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @InjectRepository(PatternConversionEntity)
    private readonly conversions: Repository<PatternConversionEntity>,
    @InjectRepository(PersonalPatternEntity)
    private readonly personalPatterns: Repository<PersonalPatternEntity>,
    @InjectRepository(ConversionRecipeEntity)
    private readonly recipes: Repository<ConversionRecipeEntity>,
    @InjectRepository(PatternEntity)
    private readonly patterns: Repository<PatternEntity>,
  ) {}

  async createPhotoConversion(
    principal: AuthPrincipal,
    dto: CreatePhotoConversionDto,
    artwork: UploadedArtwork | undefined,
  ): Promise<{ id: string; status: 'pending' }> {
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
      await this.dataSource.transaction(async (manager) => {
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

    return { id: processingJobId, status: 'pending' };
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

  private async getPersonalPattern(accountId: string, patternId: string) {
    const [pattern, recipe] = await Promise.all([
      this.patterns.findOneBy({
        id: patternId,
        ownerAccountId: accountId,
        visibility: 'personal',
      }),
      this.recipes.findOneBy({ patternId }),
    ]);
    if (pattern === null || recipe === null) {
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
      recipe: {
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
