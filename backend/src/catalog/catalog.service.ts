import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PatternEntity, TagEntity, TagLabelEntity, StaffPickEntity, PatternUnlockPriceTier, PatternStatus } from './entities';
import { FIXED_CATEGORIES } from './catalog.constants';
import { encodeCursor, decodeCursor } from './catalog.utils';
import { OBJECT_STORAGE, ObjectStorage } from './storage/object-storage.interface';

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
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly dataSource: DataSource,
  ) {}

  private formatPattern(pattern: PatternEntity, locale: string) {
    return {
      id: pattern.id,
      title: pattern.title,
      creatorName: pattern.creatorName,
      categoryCode: pattern.categoryCode,
      tags: (pattern.tags || []).map(tag => {
        const labelEntity = tag.labels?.find(l => l.locale === locale) ||
                             tag.labels?.find(l => l.locale === 'en');
        return {
          code: tag.code,
          label: labelEntity ? labelEntity.label : tag.code,
        };
      }),
      width: pattern.width,
      height: pattern.height,
      paletteSize: pattern.paletteSize,
      previewUrl: this.storage.publicUrl(pattern.previewObjectKey),
      unlockPriceTier: pattern.unlockPriceTier,
      publishedAt: pattern.publishedAt.toISOString(),
    };
  }

  async getStaffPicks(locale: string = 'en') {
    const picks = await this.staffPickRepository.find({
      order: { position: 'ASC' },
      relations: ['pattern', 'pattern.tags', 'pattern.tags.labels'],
    });
    return picks
      .filter(
        (pick) =>
          pick.pattern &&
          pick.pattern.status === 'available' &&
          pick.pattern.visibility === 'catalog',
      )
      .map(pick => this.formatPattern(pick.pattern, locale));
  }

  async getNewPatterns(limit: number = 10, cursor?: string, locale: string = 'en') {
    const queryBuilder = this.patternRepository.createQueryBuilder('pattern')
      .leftJoinAndSelect('pattern.tags', 'tag')
      .leftJoinAndSelect('tag.labels', 'label')
      .where('pattern.status = :status', { status: 'available' })
      .andWhere('pattern.visibility = :visibility', { visibility: 'catalog' });

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
    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeCursor({
        publishedAt: lastItem.publishedAt.toISOString(),
        id: lastItem.id,
      });
    }

    return {
      items: items.map(p => this.formatPattern(p, locale)),
      nextCursor,
    };
  }

  async getCategories() {
    const counts = await this.patternRepository
      .createQueryBuilder('pattern')
      .select('pattern.categoryCode', 'categoryCode')
      .addSelect('COUNT(pattern.id)', 'count')
      .where('pattern.status = :status', { status: 'available' })
      .andWhere('pattern.visibility = :visibility', { visibility: 'catalog' })
      .groupBy('pattern.categoryCode')
      .getRawMany<{ categoryCode: string; count: string }>();

    const countMap = new Map<string, number>();
    for (const row of counts) {
      countMap.set(row.categoryCode, parseInt(row.count, 10));
    }

    return FIXED_CATEGORIES.map(category => {
      const count = countMap.get(category.code) || 0;
      return {
        id: category.code,
        code: category.code,
        name: category.label,
        label: category.label,
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
      return {
        code: tag.code,
        label: labelEntity ? labelEntity.label : tag.code,
      };
    });
  }

  async getPatterns(options: { category?: string; tag?: string; limit: number; cursor?: string; locale?: string }) {
    const limit = options.limit || 10;
    const locale = options.locale || 'en';
    const queryBuilder = this.patternRepository.createQueryBuilder('pattern')
      .leftJoinAndSelect('pattern.tags', 'tag')
      .leftJoinAndSelect('tag.labels', 'label')
      .where('pattern.status = :status', { status: 'available' })
      .andWhere('pattern.visibility = :visibility', { visibility: 'catalog' });

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
    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      nextCursor = encodeCursor({
        publishedAt: lastItem.publishedAt.toISOString(),
        id: lastItem.id,
      });
    }

    return {
      items: items.map(p => this.formatPattern(p, locale)),
      nextCursor,
    };
  }

  async getPatternById(id: string, locale: string = 'en') {
    const pattern = await this.patternRepository.findOne({
      where: { id, status: 'available', visibility: 'catalog' },
      relations: ['tags', 'tags.labels'],
    });
    if (!pattern) {
      throw new NotFoundException(`Pattern with ID ${id} not found`);
    }
    return this.formatPattern(pattern, locale);
  }

  async searchPatterns(q: string, limit: number = 10, locale: string = 'en') {
    const queryBuilder = this.patternRepository.createQueryBuilder('pattern')
      .leftJoinAndSelect('pattern.tags', 'tag')
      .leftJoinAndSelect('tag.labels', 'label')
      .where('pattern.status = :status', { status: 'available' })
      .andWhere('pattern.visibility = :visibility', { visibility: 'catalog' });

    if (q) {
      const searchPattern = `%${q}%`;
      queryBuilder.andWhere(
        '(pattern.title ILIKE :searchPattern OR pattern.creatorName ILIKE :searchPattern OR EXISTS (' +
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
    return patterns.map(p => this.formatPattern(p, locale));
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
    const validCategory = FIXED_CATEGORIES.find(c => c.code === data.categoryCode);
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
