import { Inject, Injectable, NotFoundException, BadRequestException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PatternEntity, TagEntity, TagLabelEntity, StaffPickEntity, CategoryEntity, PatternUnlockPriceTier, PatternStatus } from './entities';
import { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { PatternLikeService } from '../social/pattern-like.service';
import { CreatorBlockService } from '../social/creator-block.service';

import { encodeCursor, decodeCursor } from './catalog.utils';
import { OBJECT_STORAGE, ObjectStorage } from './storage/object-storage.interface';
import { patternImageUrls } from './pattern-image-urls';
import { RELEASED_APP_DISPLAY_LOCALES } from './released-locales.constant';
import { captureOperationalAlert } from '../observability';

export interface UpsertPatternInput {
  // Only used when no existing Pattern matches (title, creatorName); ignored
  // when updating an existing row, whose id never changes. Lets a caller
  // (e.g. the Operator Console draft-publish flow) pre-generate the id it
  // needs for object storage keys before the row exists.
  id?: string;
  title: string;
  creatorName: string;
  categoryCode: string;
  width: number;
  height: number;
  paletteSize: number;
  artifactObjectKey: string;
  artifactChecksum: string;
  artifactByteLength: number;
  artifactSchemaVersion: number;
  previewObjectKey: string;
  thumbnailRendererVersion?: number | null;
  unlockPriceTier: PatternUnlockPriceTier;
  status: PatternStatus;
  publishedAt?: Date;
  tagCodes: string[];
}

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(PatternEntity)
    private readonly patternRepository: Repository<PatternEntity>,
    @InjectRepository(TagEntity)
    private readonly tagRepository: Repository<TagEntity>,
    @InjectRepository(TagLabelEntity)
    private readonly tagLabelRepository: Repository<TagLabelEntity>,
    @InjectRepository(StaffPickEntity)
    private readonly staffPickRepository: Repository<StaffPickEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => PatternLikeService))
    private readonly patternLikeService: PatternLikeService,
    @Inject(forwardRef(() => CreatorBlockService))
    private readonly creatorBlockService: CreatorBlockService,
  ) {}

  public formatPattern(pattern: PatternEntity, locale: string, viewerLiked: boolean = false) {
    const creatorName = pattern.creatorProfile?.displayName ?? pattern.creatorName;
    return {
      id: pattern.id,
      title: pattern.title,
      description: pattern.description,
      sourceLanguage: pattern.sourceLanguage,
      creatorName,
      creatorProfileId: pattern.creatorProfile?.id ?? null,
      creatorUsername: pattern.creatorProfile?.username ?? null,
      categoryCode: pattern.categoryCode,
      tags: (pattern.tags || []).map(tag => {
        const labelEntity = tag.labels?.find(l => l.locale === locale) ||
                             tag.labels?.find(l => l.locale === 'en');
        this.reportTaxonomyFallbackIfUnexpected('tag', tag.code, locale, labelEntity?.locale);
        return {
          code: tag.code,
          label: labelEntity ? labelEntity.label : tag.code,
        };
      }),
      width: pattern.width,
      height: pattern.height,
      paletteSize: pattern.paletteSize,
      ...patternImageUrls(pattern, this.storage),
      unlockPriceTier: pattern.unlockPriceTier,
      publishedAt: pattern.publishedAt.toISOString(),
      likeCount: pattern.likeCount ?? 0,
      viewerLiked,
    };
  }

  async getStaffPicks(locale: string = 'en', principal?: AuthPrincipal) {
    const queryBuilder = this.staffPickRepository.createQueryBuilder('pick')
      .innerJoinAndSelect('pick.pattern', 'pattern')
      .leftJoinAndSelect('pattern.creatorProfile', 'creatorProfile')
      .leftJoinAndSelect('pattern.tags', 'tag')
      .leftJoinAndSelect('tag.labels', 'label')
      .where('pattern.status = :status', { status: 'available' })
      .andWhere('pattern.visibility = :visibility', { visibility: 'catalog' })
      .andWhere('(creatorProfile.id IS NULL OR creatorProfile.closureHoldAt IS NULL)');

    if (principal?.type === PrincipalType.Account) {
      const hasBlocks = await this.creatorBlockService.hasBlocks(principal.id);
      if (hasBlocks) {
        queryBuilder.andWhere(
          `NOT EXISTS (
            SELECT 1 FROM "social"."creator_blocks" cb
            WHERE cb.account_id = :accountId AND cb.creator_profile_id = pattern.creator_profile_id
          )`,
          { accountId: principal.id }
        );
      }
    }

    queryBuilder.orderBy('pick.position', 'ASC');

    const availablePicks = await queryBuilder.getMany();
    const patternIds = availablePicks.map((pick) => pick.pattern.id);
    const likedIds =
      principal?.type === PrincipalType.Account && patternIds.length > 0
        ? await this.patternLikeService.getViewerLikedPatternIds(principal.id, patternIds)
        : new Set<string>();

    return availablePicks.map((pick) =>
      this.formatPattern(pick.pattern, locale, likedIds.has(pick.pattern.id)),
    );
  }

  async getNewPatterns(
    limit: number = 10,
    cursor?: string,
    locale: string = 'en',
    principal?: AuthPrincipal,
  ) {
    const queryBuilder = this.patternRepository.createQueryBuilder('pattern')
      .leftJoinAndSelect('pattern.tags', 'tag')
      .leftJoinAndSelect('tag.labels', 'label')
      .leftJoinAndSelect('pattern.creatorProfile', 'creatorProfile')
      .where('pattern.status = :status', { status: 'available' })
      .andWhere('pattern.visibility = :visibility', { visibility: 'catalog' })
      .andWhere('(creatorProfile.id IS NULL OR creatorProfile.closureHoldAt IS NULL)');

    if (principal?.type === PrincipalType.Account) {
      const hasBlocks = await this.creatorBlockService.hasBlocks(principal.id);
      if (hasBlocks) {
        queryBuilder.andWhere(
          `NOT EXISTS (
            SELECT 1 FROM "social"."creator_blocks" cb
            WHERE cb.account_id = :accountId AND cb.creator_profile_id = pattern.creator_profile_id
          )`,
          { accountId: principal.id }
        );
      }
    }

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded) {
        queryBuilder.andWhere(
          '(pattern.published_at < :publishedAt OR (pattern.published_at = :publishedAt AND pattern.id < :id))',
          {
            publishedAt: new Date(decoded.publishedAt),
            id: decoded.id,
          },
        );
      }
    }

    queryBuilder
      .orderBy('pattern.publishedAt', 'DESC')
      .addOrderBy('pattern.id', 'DESC')
      .take(limit + 1);

    const patterns = await queryBuilder.getMany();
    const hasMore = patterns.length > limit;
    const items = patterns.slice(0, limit);
    const patternIds = items.map((p) => p.id);
    const likedIds =
      principal?.type === PrincipalType.Account && patternIds.length > 0
        ? await this.patternLikeService.getViewerLikedPatternIds(principal.id, patternIds)
        : new Set<string>();

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeCursor({
        publishedAt: lastItem.publishedAt.toISOString(),
        id: lastItem.id,
      });
    }

    return {
      items: items.map((p) => this.formatPattern(p, locale, likedIds.has(p.id))),
      nextCursor,
    };
  }

  async getCategories(locale: string = 'en') {
    const [categories, counts] = await Promise.all([
      this.categoryRepository.find({ relations: ['labels'], order: { code: 'ASC' }, where: { active: true } }),
      this.patternRepository
        .createQueryBuilder('pattern')
        .select('pattern.categoryCode', 'categoryCode')
        .addSelect('COUNT(pattern.id)', 'count')
        .leftJoin('pattern.creatorProfile', 'creatorProfile')
        .where('pattern.status = :status', { status: 'available' })
        .andWhere('pattern.visibility = :visibility', { visibility: 'catalog' })
        .andWhere('(creatorProfile.id IS NULL OR creatorProfile.closureHoldAt IS NULL)')
        .groupBy('pattern.categoryCode')
        .getRawMany<{ categoryCode: string; count: string }>(),
    ]);

    const countMap = new Map<string, number>();
    for (const row of counts) {
      countMap.set(row.categoryCode, parseInt(row.count, 10));
    }

    return categories.map(category => {
      const count = countMap.get(category.code) || 0;
      const labelEntity = category.labels?.find(l => l.locale === locale) ||
                          category.labels?.find(l => l.locale === 'en');
      this.reportTaxonomyFallbackIfUnexpected('category', category.code, locale, labelEntity?.locale);
      const label = labelEntity ? labelEntity.label : category.code;
      return {
        id: category.code,
        code: category.code,
        name: label,
        label,
        count,
        patternCount: count,
      };
    });
  }

  async getTags(locale: string = 'en') {
    const tags = await this.tagRepository.find({
      relations: ['labels'],
      where: { active: true },
    });
    return tags.map(tag => {
      const labelEntity = tag.labels?.find(l => l.locale === locale) ||
                           tag.labels?.find(l => l.locale === 'en');
      this.reportTaxonomyFallbackIfUnexpected('tag', tag.code, locale, labelEntity?.locale);
      return {
        code: tag.code,
        label: labelEntity ? labelEntity.label : tag.code,
      };
    });
  }

  async getPatterns(options: {
    category?: string;
    tag?: string;
    limit: number;
    cursor?: string;
    locale?: string;
    principal?: AuthPrincipal;
  }) {
    const limit = options.limit || 10;
    const locale = options.locale || 'en';
    const queryBuilder = this.patternRepository.createQueryBuilder('pattern')
      .leftJoinAndSelect('pattern.tags', 'tag')
      .leftJoinAndSelect('tag.labels', 'label')
      .leftJoinAndSelect('pattern.creatorProfile', 'creatorProfile')
      .where('pattern.status = :status', { status: 'available' })
      .andWhere('pattern.visibility = :visibility', { visibility: 'catalog' })
      .andWhere('(creatorProfile.id IS NULL OR creatorProfile.closureHoldAt IS NULL)');

    if (options.principal?.type === PrincipalType.Account) {
      const hasBlocks = await this.creatorBlockService.hasBlocks(options.principal.id);
      if (hasBlocks) {
        queryBuilder.andWhere(
          `NOT EXISTS (
            SELECT 1 FROM "social"."creator_blocks" cb
            WHERE cb.account_id = :accountId AND cb.creator_profile_id = pattern.creator_profile_id
          )`,
          { accountId: options.principal.id }
        );
      }
    }

    if (options.category) {
      queryBuilder.andWhere('pattern.categoryCode = :category', { category: options.category });
    }

    if (options.tag) {
      queryBuilder.andWhere(qb => {
        const subQuery = qb.subQuery()
          .select('pt.pattern_id')
          .from('catalog.pattern_tags', 'pt')
          .where('pt.tag_code = :tagCode', { tagCode: options.tag })
          .getQuery();
        return 'pattern.id IN ' + subQuery;
      });
    }

    if (options.cursor) {
      const decoded = decodeCursor(options.cursor);
      if (decoded) {
        queryBuilder.andWhere(
          '(pattern.published_at < :publishedAt OR (pattern.published_at = :publishedAt AND pattern.id < :id))',
          {
            publishedAt: new Date(decoded.publishedAt),
            id: decoded.id,
          },
        );
      }
    }

    queryBuilder
      .orderBy('pattern.publishedAt', 'DESC')
      .addOrderBy('pattern.id', 'DESC')
      .take(limit + 1);

    const patterns = await queryBuilder.getMany();
    const hasMore = patterns.length > limit;
    const items = patterns.slice(0, limit);
    const patternIds = items.map((p) => p.id);
    const likedIds =
      options.principal?.type === PrincipalType.Account && patternIds.length > 0
        ? await this.patternLikeService.getViewerLikedPatternIds(options.principal.id, patternIds)
        : new Set<string>();

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeCursor({
        publishedAt: lastItem.publishedAt.toISOString(),
        id: lastItem.id,
      });
    }

    return {
      items: items.map((p) => this.formatPattern(p, locale, likedIds.has(p.id))),
      nextCursor,
    };
  }

  async getPatternById(id: string, locale: string = 'en', principal?: AuthPrincipal) {
    const pattern = await this.patternRepository.findOne({
      where: { id, status: 'available', visibility: 'catalog' },
      relations: ['creatorProfile', 'tags', 'tags.labels'],
    });
    if (!pattern || (pattern.creatorProfile?.closureHoldAt ?? null) !== null) {
      throw new NotFoundException(`Pattern with ID ${id} not found`);
    }
    const likedIds =
      principal?.type === PrincipalType.Account
        ? await this.patternLikeService.getViewerLikedPatternIds(principal.id, [id])
        : new Set<string>();
    return this.formatPattern(pattern, locale, likedIds.has(id));
  }

  async searchPatterns(
    q: string,
    limit: number = 10,
    locale: string = 'en',
    principal?: AuthPrincipal,
  ) {
    const queryBuilder = this.patternRepository.createQueryBuilder('pattern')
      .leftJoinAndSelect('pattern.tags', 'tag')
      .leftJoinAndSelect('tag.labels', 'label')
      .leftJoinAndSelect('pattern.creatorProfile', 'creatorProfile')
      .where('pattern.status = :status', { status: 'available' })
      .andWhere('pattern.visibility = :visibility', { visibility: 'catalog' })
      .andWhere('(creatorProfile.id IS NULL OR creatorProfile.closureHoldAt IS NULL)');

    if (principal?.type === PrincipalType.Account) {
      const hasBlocks = await this.creatorBlockService.hasBlocks(principal.id);
      if (hasBlocks) {
        queryBuilder.andWhere(
          `NOT EXISTS (
            SELECT 1 FROM "social"."creator_blocks" cb
            WHERE cb.account_id = :accountId AND cb.creator_profile_id = pattern.creator_profile_id
          )`,
          { accountId: principal.id }
        );
      }
    }

    if (q) {
      const searchPattern = `%${q}%`;
      queryBuilder.andWhere(
        '(pattern.title ILIKE :searchPattern OR pattern.creatorName ILIKE :searchPattern OR creatorProfile.username ILIKE :searchPattern OR EXISTS (' +
          'SELECT 1 FROM catalog.pattern_tags pt ' +
          'JOIN catalog.tag_labels tl ON tl.tag_code = pt.tag_code ' +
          'WHERE pt.pattern_id = pattern.id ' +
            'AND (tl.locale = :locale OR tl.locale = \'en\') ' +
            'AND tl.label ILIKE :searchPattern' +
        '))',
        { searchPattern, locale },
      );
    }

    queryBuilder
      .orderBy('pattern.publishedAt', 'DESC')
      .addOrderBy('pattern.id', 'DESC')
      .take(limit);

    const patterns = await queryBuilder.getMany();
    const patternIds = patterns.map((p) => p.id);
    const likedIds =
      principal?.type === PrincipalType.Account && patternIds.length > 0
        ? await this.patternLikeService.getViewerLikedPatternIds(principal.id, patternIds)
        : new Set<string>();

    return patterns.map((p) => this.formatPattern(p, locale, likedIds.has(p.id)));
  }

  private reportTaxonomyFallbackIfUnexpected(
    taxonomyType: 'category' | 'tag',
    code: string,
    requestedLocale: string,
    resolvedLocale: string | undefined,
  ): void {
    if (
      resolvedLocale !== requestedLocale &&
      RELEASED_APP_DISPLAY_LOCALES.includes(requestedLocale as typeof RELEASED_APP_DISPLAY_LOCALES[number])
    ) {
      captureOperationalAlert(
        'Unexpected catalog taxonomy locale fallback',
        'warning',
        'catalog-taxonomy-fallback',
        { taxonomyType, code, requestedLocale },
      );
    }
  }

  upsertPattern(data: UpsertPatternInput): Promise<PatternEntity> {
    return this.dataSource.transaction((manager) =>
      this.upsertPatternWithManager(data, manager),
    );
  }

  // Manager-aware variant so callers that need this write inside a larger
  // transaction (e.g. the Operator Console's draft-publish flow) can compose
  // it atomically with their own mutations, instead of committing separately.
  async upsertPatternWithManager(
    data: UpsertPatternInput,
    manager: EntityManager,
  ): Promise<PatternEntity> {
    if (data.tagCodes.length > 5) {
      throw new BadRequestException('A pattern can have at most 5 tags');
    }
    const categoryRepository = manager.getRepository(CategoryEntity);
    const validCategory = await categoryRepository.findOne({
      where: { active: true, code: data.categoryCode },
    });
    if (!validCategory) {
      throw new BadRequestException(`Invalid category code: ${data.categoryCode}`);
    }

    const tagRepository = manager.getRepository(TagEntity);
    const patternRepository = manager.getRepository(PatternEntity);

    // Find or create tags
    const tags: TagEntity[] = [];
    for (const tagCode of data.tagCodes) {
      let tag = await tagRepository.findOne({ where: { code: tagCode } });
      if (!tag) {
        tag = tagRepository.create({ code: tagCode });
        await tagRepository.save(tag);
      }
      tags.push(tag);
    }

    // Upsert by title + creatorName
    let pattern = await patternRepository.findOne({
      where: {
        title: data.title,
        creatorName: data.creatorName,
        visibility: 'catalog',
      },
      relations: ['tags'],
    });

    if (pattern) {
      pattern.categoryCode = data.categoryCode;
      pattern.width = data.width;
      pattern.height = data.height;
      pattern.paletteSize = data.paletteSize;
      pattern.artifactObjectKey = data.artifactObjectKey;
      pattern.artifactChecksum = data.artifactChecksum;
      pattern.artifactByteLength = data.artifactByteLength;
      pattern.artifactSchemaVersion = data.artifactSchemaVersion;
      pattern.previewObjectKey = data.previewObjectKey;
      pattern.thumbnailRendererVersion = data.thumbnailRendererVersion ?? null;
      pattern.unlockPriceTier = data.unlockPriceTier;
      pattern.status = data.status;
      pattern.visibility = 'catalog';
      pattern.ownerAccountId = null;
      pattern.tags = tags;
    } else {
      pattern = patternRepository.create({
        id: data.id,
        title: data.title,
        creatorName: data.creatorName,
        categoryCode: data.categoryCode,
        width: data.width,
        height: data.height,
        paletteSize: data.paletteSize,
        artifactObjectKey: data.artifactObjectKey,
        artifactChecksum: data.artifactChecksum,
        artifactByteLength: data.artifactByteLength,
        artifactSchemaVersion: data.artifactSchemaVersion,
        previewObjectKey: data.previewObjectKey,
        thumbnailRendererVersion: data.thumbnailRendererVersion ?? null,
        unlockPriceTier: data.unlockPriceTier,
        status: data.status,
        visibility: 'catalog',
        ownerAccountId: null,
        publishedAt: data.publishedAt || new Date(),
        tags,
      });
    }

    return await patternRepository.save(pattern);
  }

  async setStaffPick(patternTitle: string, patternCreator: string, position: number) {
    const pattern = await this.patternRepository.findOne({
      where: {
        title: patternTitle,
        creatorName: patternCreator,
        visibility: 'catalog',
      },
    });
    if (!pattern) {
      throw new NotFoundException(`Pattern ${patternTitle} by ${patternCreator} not found`);
    }

    // Remove staff pick at this position if exists, or remove existing pick for this pattern
    const existingByPosition = await this.staffPickRepository.findOne({ where: { position } });
    if (existingByPosition && existingByPosition.patternId !== pattern.id) {
      await this.staffPickRepository.remove(existingByPosition);
    }

    const existingByPattern = await this.staffPickRepository.findOne({ where: { patternId: pattern.id } });
    if (existingByPattern) {
      existingByPattern.position = position;
      await this.staffPickRepository.save(existingByPattern);
    } else {
      const pick = this.staffPickRepository.create({
        patternId: pattern.id,
        position,
      });
      await this.staffPickRepository.save(pick);
    }
  }

  async upsertTagLabels(tagCode: string, labels: { locale: string; label: string }[]) {
    let tag = await this.tagRepository.findOne({ where: { code: tagCode } });
    if (!tag) {
      tag = this.tagRepository.create({ code: tagCode });
      await this.tagRepository.save(tag);
    }

    for (const item of labels) {
      let labelEntity = await this.tagLabelRepository.findOne({
        where: { tagCode, locale: item.locale },
      });
      if (labelEntity) {
        labelEntity.label = item.label;
      } else {
        labelEntity = this.tagLabelRepository.create({
          tagCode,
          locale: item.locale,
          label: item.label,
        });
      }
      await this.tagLabelRepository.save(labelEntity);
    }
  }
}
