import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { FIXED_CATEGORIES } from '../catalog/catalog.constants';
import {
  PatternEntity,
  PatternStatus,
  StaffPickEntity,
  TagEntity,
  TagLabelEntity,
} from '../catalog/entities';
import { LocalObjectStorage } from '../catalog/storage/local-object-storage';
import { MAX_TAG_CODES_PER_PATTERN } from './admin.constants';
import { OperatorAuditLogService } from './operator-audit-log.service';

export interface AdminPatternListItem {
  id: string;
  title: string;
  creatorName: string;
  categoryCode: string;
  status: PatternStatus;
  unlockPriceTier: string | null;
  previewUrl: string;
  publishedAt: string;
  createdAt: string;
}

export interface AdminPatternDetail extends AdminPatternListItem {
  width: number;
  height: number;
  paletteSize: number;
  tags: { code: string; label: string }[];
}

export interface AdminPatternPage {
  items: AdminPatternListItem[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: LocalObjectStorage,
    private readonly auditLog: OperatorAuditLogService,
    @InjectRepository(PatternEntity)
    private readonly patterns: Repository<PatternEntity>,
    @InjectRepository(TagEntity)
    private readonly tags: Repository<TagEntity>,
    @InjectRepository(TagLabelEntity)
    private readonly tagLabels: Repository<TagLabelEntity>,
    @InjectRepository(StaffPickEntity)
    private readonly staffPicks: Repository<StaffPickEntity>,
  ) {}

  async listPatterns(options: {
    status?: PatternStatus;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<AdminPatternPage> {
    const queryBuilder = this.patterns
      .createQueryBuilder('pattern')
      .where('pattern.visibility = :visibility', { visibility: 'catalog' });

    if (options.status !== undefined) {
      queryBuilder.andWhere('pattern.status = :status', { status: options.status });
    }
    if (options.search !== undefined && options.search.trim().length > 0) {
      queryBuilder.andWhere(
        '(pattern.title ILIKE :search OR pattern.creatorName ILIKE :search)',
        { search: `%${options.search.trim()}%` },
      );
    }

    queryBuilder
      .orderBy('pattern.createdAt', 'DESC')
      .addOrderBy('pattern.id', 'DESC')
      .skip((options.page - 1) * options.pageSize)
      .take(options.pageSize);

    const [items, total] = await queryBuilder.getManyAndCount();
    return {
      items: items.map((pattern) => this.formatListItem(pattern)),
      page: options.page,
      pageSize: options.pageSize,
      total,
    };
  }

  async getPatternById(id: string): Promise<AdminPatternDetail> {
    const pattern = await this.patterns.findOne({
      relations: ['tags', 'tags.labels'],
      where: { id, visibility: 'catalog' },
    });
    if (pattern === null) {
      throw new NotFoundException(`Pattern ${id} was not found`);
    }
    return this.formatDetail(pattern);
  }

  async updateMetadata(
    operatorAccountId: string,
    patternId: string,
    dto: { title: string; creatorName: string; categoryCode: string; tagCodes: string[] },
    requestId: string | null,
  ): Promise<AdminPatternDetail> {
    if (dto.tagCodes.length > MAX_TAG_CODES_PER_PATTERN) {
      throw new BadRequestException(
        `A pattern can have at most ${MAX_TAG_CODES_PER_PATTERN} tags`,
      );
    }
    if (!FIXED_CATEGORIES.some((category) => category.code === dto.categoryCode)) {
      throw new BadRequestException(`Invalid category code: ${dto.categoryCode}`);
    }

    return this.dataSource.transaction(async (manager) => {
      const patternRepository = manager.getRepository(PatternEntity);
      const tagRepository = manager.getRepository(TagEntity);
      const pattern = await patternRepository.findOne({
        relations: ['tags', 'tags.labels'],
        where: { id: patternId, visibility: 'catalog' },
      });
      if (pattern === null) {
        throw new NotFoundException(`Pattern ${patternId} was not found`);
      }

      const tags: TagEntity[] = [];
      for (const code of dto.tagCodes) {
        const tag = await tagRepository.findOne({ where: { code } });
        if (tag === null) {
          throw new BadRequestException(`Unknown tag code: ${code}`);
        }
        tags.push(tag);
      }

      const before = this.formatDetail(pattern);
      pattern.title = dto.title;
      pattern.creatorName = dto.creatorName;
      pattern.categoryCode = dto.categoryCode;
      pattern.tags = tags;
      const saved = await patternRepository.save(pattern);
      const after = this.formatDetail(saved);

      await this.auditLog.record(manager, {
        action: 'pattern.metadata.update',
        after,
        before,
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: patternId,
        targetType: 'pattern',
      });

      return after;
    });
  }

  withdrawPattern(operatorAccountId: string, patternId: string, requestId: string | null) {
    return this.applyStatusTransition(operatorAccountId, patternId, {
      action: 'pattern.withdraw',
      from: ['available', 'withdrawn'],
      requestId,
      to: 'withdrawn',
    });
  }

  removePattern(operatorAccountId: string, patternId: string, requestId: string | null) {
    return this.applyStatusTransition(operatorAccountId, patternId, {
      action: 'pattern.remove',
      from: ['available', 'withdrawn', 'removed'],
      requestId,
      to: 'removed',
    });
  }

  restorePattern(operatorAccountId: string, patternId: string, requestId: string | null) {
    return this.applyStatusTransition(operatorAccountId, patternId, {
      action: 'pattern.restore',
      from: ['withdrawn', 'removed', 'available'],
      requestId,
      to: 'available',
    });
  }

  async getStaffPicks(): Promise<{ patternId: string; title: string; creatorName: string; position: number }[]> {
    const picks = await this.staffPicks.find({
      order: { position: 'ASC' },
      relations: ['pattern'],
    });
    return picks
      .filter((pick) => pick.pattern !== null)
      .map((pick) => ({
        creatorName: pick.pattern.creatorName,
        patternId: pick.patternId,
        position: pick.position,
        title: pick.pattern.title,
      }));
  }

  async replaceStaffPicks(
    operatorAccountId: string,
    patternIds: string[],
    requestId: string | null,
  ): Promise<{ patternId: string; title: string; creatorName: string; position: number }[]> {
    return this.dataSource.transaction(async (manager) => {
      const patternRepository = manager.getRepository(PatternEntity);
      const staffPickRepository = manager.getRepository(StaffPickEntity);

      const before = await this.getStaffPicksWithManager(manager);

      const patterns: PatternEntity[] = [];
      for (const patternId of patternIds) {
        const pattern = await patternRepository.findOne({
          where: { id: patternId, status: 'available', visibility: 'catalog' },
        });
        if (pattern === null) {
          throw new BadRequestException(
            `Pattern ${patternId} is not an available catalog Pattern and cannot be a Staff Pick`,
          );
        }
        patterns.push(pattern);
      }

      await staffPickRepository.createQueryBuilder().delete().execute();
      const rows = patterns.map((pattern, index) =>
        staffPickRepository.create({ patternId: pattern.id, position: index + 1 }),
      );
      if (rows.length > 0) {
        await staffPickRepository.save(rows);
      }

      const after = patterns.map((pattern, index) => ({
        creatorName: pattern.creatorName,
        patternId: pattern.id,
        position: index + 1,
        title: pattern.title,
      }));

      await this.auditLog.record(manager, {
        action: 'staffpick.replace',
        after: { picks: after },
        before: { picks: before },
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: null,
        targetType: 'staff_picks',
      });

      return after;
    });
  }

  async listTags(): Promise<{ code: string; active: boolean; labels: { locale: string; label: string }[] }[]> {
    const tags = await this.tags.find({ order: { code: 'ASC' }, relations: ['labels'] });
    return tags.map((tag) => ({
      active: tag.active,
      code: tag.code,
      labels: (tag.labels ?? []).map((label) => ({ label: label.label, locale: label.locale })),
    }));
  }

  async createTag(
    operatorAccountId: string,
    code: string,
    labels: { locale: string; label: string }[],
    requestId: string | null,
  ): Promise<{ code: string; active: boolean; labels: { locale: string; label: string }[] }> {
    return this.dataSource.transaction(async (manager) => {
      const tagRepository = manager.getRepository(TagEntity);
      const tagLabelRepository = manager.getRepository(TagLabelEntity);

      const existing = await tagRepository.findOne({ where: { code } });
      if (existing !== null) {
        throw new BadRequestException(`Tag code "${code}" already exists`);
      }

      await tagRepository.save(tagRepository.create({ active: true, code }));
      await tagLabelRepository.save(
        labels.map((label) =>
          tagLabelRepository.create({ label: label.label, locale: label.locale, tagCode: code }),
        ),
      );

      const after = { active: true, code, labels };
      await this.auditLog.record(manager, {
        action: 'tag.create',
        after,
        before: null,
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: code,
        targetType: 'tag',
      });
      return after;
    });
  }

  async updateTagLabels(
    operatorAccountId: string,
    code: string,
    labels: { locale: string; label: string }[],
    requestId: string | null,
  ): Promise<{ code: string; active: boolean; labels: { locale: string; label: string }[] }> {
    return this.dataSource.transaction(async (manager) => {
      const tagRepository = manager.getRepository(TagEntity);
      const tagLabelRepository = manager.getRepository(TagLabelEntity);

      const tag = await tagRepository.findOne({ relations: ['labels'], where: { code } });
      if (tag === null) {
        throw new NotFoundException(`Tag code "${code}" was not found`);
      }
      const before = {
        active: tag.active,
        code: tag.code,
        labels: (tag.labels ?? []).map((label) => ({ label: label.label, locale: label.locale })),
      };

      for (const input of labels) {
        const existingLabel = await tagLabelRepository.findOne({
          where: { locale: input.locale, tagCode: code },
        });
        if (existingLabel !== null) {
          existingLabel.label = input.label;
          await tagLabelRepository.save(existingLabel);
        } else {
          await tagLabelRepository.save(
            tagLabelRepository.create({ label: input.label, locale: input.locale, tagCode: code }),
          );
        }
      }

      const after = { active: tag.active, code, labels };
      await this.auditLog.record(manager, {
        action: 'tag.labels.update',
        after,
        before,
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: code,
        targetType: 'tag',
      });
      return after;
    });
  }

  async deactivateTag(
    operatorAccountId: string,
    code: string,
    requestId: string | null,
  ): Promise<{ code: string; active: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const tagRepository = manager.getRepository(TagEntity);
      const tag = await tagRepository.findOne({ where: { code } });
      if (tag === null) {
        throw new NotFoundException(`Tag code "${code}" was not found`);
      }
      const wasActive = tag.active;
      if (wasActive) {
        tag.active = false;
        await tagRepository.save(tag);
      }

      await this.auditLog.record(manager, {
        action: 'tag.deactivate',
        after: { active: false, code },
        before: { active: wasActive, code },
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: code,
        targetType: 'tag',
      });
      return { active: false, code };
    });
  }

  private async applyStatusTransition(
    operatorAccountId: string,
    patternId: string,
    options: {
      action: string;
      from: readonly PatternStatus[];
      to: PatternStatus;
      requestId: string | null;
    },
  ): Promise<AdminPatternDetail> {
    return this.dataSource.transaction(async (manager) => {
      const patternRepository = manager.getRepository(PatternEntity);
      const pattern = await patternRepository.findOne({
        relations: ['tags', 'tags.labels'],
        where: { id: patternId, visibility: 'catalog' },
      });
      if (pattern === null) {
        throw new NotFoundException(`Pattern ${patternId} was not found`);
      }
      if (!options.from.includes(pattern.status)) {
        throw new BadRequestException(
          `Pattern ${patternId} cannot transition from ${pattern.status} to ${options.to}`,
        );
      }

      const before = this.formatDetail(pattern);
      if (pattern.status !== options.to) {
        pattern.status = options.to;
        await patternRepository.save(pattern);
      }
      const after = this.formatDetail(pattern);

      await this.auditLog.record(manager, {
        action: options.action,
        after,
        before,
        operatorAccountId,
        outcome: 'success',
        requestId: options.requestId,
        targetId: patternId,
        targetType: 'pattern',
      });
      return after;
    });
  }

  private async getStaffPicksWithManager(
    manager: EntityManager,
  ): Promise<{ patternId: string; title: string; creatorName: string; position: number }[]> {
    const picks = await manager.getRepository(StaffPickEntity).find({
      order: { position: 'ASC' },
      relations: ['pattern'],
    });
    return picks
      .filter((pick) => pick.pattern !== null)
      .map((pick) => ({
        creatorName: pick.pattern.creatorName,
        patternId: pick.patternId,
        position: pick.position,
        title: pick.pattern.title,
      }));
  }

  private formatListItem(pattern: PatternEntity): AdminPatternListItem {
    return {
      categoryCode: pattern.categoryCode,
      createdAt: pattern.createdAt.toISOString(),
      creatorName: pattern.creatorName,
      id: pattern.id,
      previewUrl: this.storage.publicUrl(pattern.previewObjectKey),
      publishedAt: pattern.publishedAt.toISOString(),
      status: pattern.status,
      title: pattern.title,
      unlockPriceTier: pattern.unlockPriceTier,
    };
  }

  private formatDetail(pattern: PatternEntity): AdminPatternDetail {
    return {
      ...this.formatListItem(pattern),
      height: pattern.height,
      paletteSize: pattern.paletteSize,
      tags: (pattern.tags ?? []).map((tag) => {
        const labelEntity =
          tag.labels?.find((label) => label.locale === 'en') ?? tag.labels?.[0];
        return { code: tag.code, label: labelEntity ? labelEntity.label : tag.code };
      }),
      width: pattern.width,
    };
  }
}
