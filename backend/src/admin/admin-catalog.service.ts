import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import {
  CategoryEntity,
  CatalogWithdrawalEntity,
  PatternEntity,
  PatternStatus,
  StaffPickEntity,
  TagEntity,
  TagLabelEntity,
} from '../catalog/entities';
import { OBJECT_STORAGE, ObjectStorage } from '../catalog/storage/object-storage.interface';
import { MAX_TAG_CODES_PER_PATTERN } from './admin.constants';
import { BulkPatternRemovalEntity } from './entities';
import { OperatorAuditLogService } from './operator-audit-log.service';

export interface AdminPatternListItem {
  id: string;
  title: string;
  creatorName: string;
  categoryCode: string;
  status: PatternStatus;
  patternType: 'official' | 'community';
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

export interface StaffPickListItem {
  patternId: string;
  title: string;
  creatorName: string;
  position: number;
  previewUrl: string;
}

@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly auditLog: OperatorAuditLogService,
    @InjectRepository(PatternEntity)
    private readonly patterns: Repository<PatternEntity>,
    @InjectRepository(TagEntity)
    private readonly tags: Repository<TagEntity>,
    @InjectRepository(TagLabelEntity)
    private readonly tagLabels: Repository<TagLabelEntity>,
    @InjectRepository(StaffPickEntity)
    private readonly staffPicks: Repository<StaffPickEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categories: Repository<CategoryEntity>,
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

    return this.dataSource.transaction(async (manager) => {
      const patternRepository = manager.getRepository(PatternEntity);
      const tagRepository = manager.getRepository(TagEntity);
      const categoryRepository = manager.getRepository(CategoryEntity);
      const pattern = await patternRepository.findOne({
        relations: ['tags', 'tags.labels'],
        where: { id: patternId, visibility: 'catalog' },
      });
      if (pattern === null) {
        throw new NotFoundException(`Pattern ${patternId} was not found`);
      }

      const category = await categoryRepository.findOne({
        where: { active: true, code: dto.categoryCode },
      });
      if (category === null) {
        throw new BadRequestException(`Invalid category code: ${dto.categoryCode}`);
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

  async bulkRemovePatterns(
    operatorAccountId: string,
    patternIds: string[],
    reason: string,
    batchId: string,
    requestId: string | null,
  ): Promise<{ batchId: string; patternIds: string[]; removedCount: number }> {
    const trimmedReason = reason.trim();
    const canonicalBatchId = batchId.toLowerCase();
    const canonicalPatternIds = patternIds.map((id) => id.toLowerCase()).sort();
    if (patternIds.length < 1 || patternIds.length > 20) {
      throw new BadRequestException('Bulk removal requires between 1 and 20 Pattern IDs');
    }
    if (new Set(canonicalPatternIds).size !== canonicalPatternIds.length) {
      throw new BadRequestException('Bulk removal Pattern IDs must be unique');
    }
    if (trimmedReason.length < 10 || trimmedReason.length > 2000) {
      throw new BadRequestException('Bulk removal reason must be between 10 and 2000 characters');
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${operatorAccountId}:${canonicalBatchId}`,
      ]);
      const receiptRepository = manager.getRepository(BulkPatternRemovalEntity);
      const receipt = await receiptRepository.findOneBy({
        batchId: canonicalBatchId,
        operatorAccountId,
      });
      if (receipt !== null) {
        if (
          receipt.reason !== trimmedReason
          || JSON.stringify(receipt.patternIds) !== JSON.stringify(canonicalPatternIds)
        ) {
          throw new BadRequestException('Bulk removal batch ID was already used with a different request');
        }
        return {
          batchId: receipt.batchId,
          patternIds: receipt.patternIds,
          removedCount: receipt.removedCount,
        };
      }

      const patternRepository = manager.getRepository(PatternEntity);
      const patterns = await patternRepository
        .createQueryBuilder('pattern')
        .setLock('pessimistic_write')
        .where('pattern.id IN (:...patternIds)', { patternIds: canonicalPatternIds })
        .andWhere('pattern.visibility = :visibility', { visibility: 'catalog' })
        .getMany();

      if (patterns.length !== patternIds.length) {
        throw new BadRequestException('One or more selected Patterns were not found');
      }
      const byId = new Map(patterns.map((pattern) => [pattern.id, pattern]));
      const orderedPatterns = canonicalPatternIds.map((id) => byId.get(id)!);
      for (const pattern of orderedPatterns) {
        if (pattern.creatorProfileId !== null) {
          throw new BadRequestException(`Pattern ${pattern.id} is a Community Pattern and is not eligible for bulk removal`);
        }
        if (pattern.status !== 'available' && pattern.status !== 'withdrawn') {
          throw new BadRequestException(`Pattern ${pattern.id} with status ${pattern.status} is not eligible for bulk removal`);
        }
      }

      const beforeById = new Map(
        orderedPatterns.map((pattern) => [pattern.id, this.formatListItem(pattern)]),
      );
      for (const pattern of orderedPatterns) {
        pattern.status = 'removed';
      }
      await patternRepository.save(orderedPatterns);

      const staffPickRepository = manager.getRepository(StaffPickEntity);
      await manager.query(
        'SELECT pattern_id FROM catalog.staff_picks ORDER BY position FOR UPDATE',
      );
      const existingPicks = await staffPickRepository.find({
        order: { position: 'ASC' },
        relations: ['pattern'],
      });
      const selectedIds = new Set(canonicalPatternIds);
      const remainingPicks = existingPicks.filter((pick) => !selectedIds.has(pick.patternId));
      const staffPicksBefore = this.formatStaffPicks(existingPicks);
      await this.writeStaffPickOrder(manager, remainingPicks.map((pick) => pick.patternId));
      const staffPicksAfter = this.formatStaffPicks(
        remainingPicks.map((pick, index) => ({ ...pick, position: index + 1 })),
      );

      for (const pattern of orderedPatterns) {
        await this.auditLog.record(manager, {
          action: 'pattern.bulk_remove',
          after: { batchId: canonicalBatchId, pattern: this.formatListItem(pattern), reason: trimmedReason },
          before: { batchId: canonicalBatchId, pattern: beforeById.get(pattern.id), reason: trimmedReason },
          operatorAccountId,
          outcome: 'success',
          requestId,
          targetId: pattern.id,
          targetType: 'pattern',
        });
      }

      await this.auditLog.record(manager, {
        action: 'staffpick.bulk_remove_compact',
        after: { batchId: canonicalBatchId, picks: staffPicksAfter, reason: trimmedReason },
        before: { batchId: canonicalBatchId, picks: staffPicksBefore, reason: trimmedReason },
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: null,
        targetType: 'staff_picks',
      });

      const result = {
        batchId: canonicalBatchId,
        patternIds: canonicalPatternIds,
        removedCount: orderedPatterns.length,
      };
      await receiptRepository.save(receiptRepository.create({
        ...result,
        operatorAccountId,
        reason: trimmedReason,
      }));
      return result;
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

  async getStaffPicks(): Promise<StaffPickListItem[]> {
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
        previewUrl: this.storage.publicUrl(pick.pattern.previewObjectKey),
        title: pick.pattern.title,
      }));
  }

  async replaceStaffPicks(
    operatorAccountId: string,
    patternIds: string[],
    requestId: string | null,
  ): Promise<StaffPickListItem[]> {
    return this.dataSource.transaction(async (manager) => {
      const patternRepository = manager.getRepository(PatternEntity);

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

      await this.writeStaffPickOrder(manager, patterns.map((pattern) => pattern.id));

      const after = patterns.map((pattern, index) => ({
        creatorName: pattern.creatorName,
        patternId: pattern.id,
        position: index + 1,
        previewUrl: this.storage.publicUrl(pattern.previewObjectKey),
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

  async listCategories(): Promise<{ code: string; label: string; active: boolean }[]> {
    const categories = await this.categories.find({ order: { code: 'ASC' } });
    return categories.map((category) => ({
      active: category.active,
      code: category.code,
      label: category.label,
    }));
  }

  async createCategory(
    operatorAccountId: string,
    code: string,
    label: string,
    requestId: string | null,
  ): Promise<{ code: string; label: string; active: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const categoryRepository = manager.getRepository(CategoryEntity);

      const existing = await categoryRepository.findOne({ where: { code } });
      if (existing !== null) {
        throw new BadRequestException(`Category code "${code}" already exists`);
      }

      await categoryRepository.save(categoryRepository.create({ active: true, code, label }));

      const after = { active: true, code, label };
      await this.auditLog.record(manager, {
        action: 'category.create',
        after,
        before: null,
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: code,
        targetType: 'category',
      });
      return after;
    });
  }

  async updateCategoryLabel(
    operatorAccountId: string,
    code: string,
    label: string,
    requestId: string | null,
  ): Promise<{ code: string; label: string; active: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const categoryRepository = manager.getRepository(CategoryEntity);

      const category = await categoryRepository.findOne({ where: { code } });
      if (category === null) {
        throw new NotFoundException(`Category code "${code}" was not found`);
      }
      const before = { active: category.active, code: category.code, label: category.label };

      category.label = label;
      await categoryRepository.save(category);

      const after = { active: category.active, code, label };
      await this.auditLog.record(manager, {
        action: 'category.label.update',
        after,
        before,
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: code,
        targetType: 'category',
      });
      return after;
    });
  }

  async deactivateCategory(
    operatorAccountId: string,
    code: string,
    requestId: string | null,
  ): Promise<{ code: string; active: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const categoryRepository = manager.getRepository(CategoryEntity);
      const category = await categoryRepository.findOne({ where: { code } });
      if (category === null) {
        throw new NotFoundException(`Category code "${code}" was not found`);
      }
      const wasActive = category.active;
      if (wasActive) {
        category.active = false;
        await categoryRepository.save(category);
      }

      await this.auditLog.record(manager, {
        action: 'category.deactivate',
        after: { active: false, code },
        before: { active: wasActive, code },
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: code,
        targetType: 'category',
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
      if (options.action === 'pattern.withdraw' && pattern.creatorProfileId !== null) {
        throw new BadRequestException(
          'Community Patterns can only be withdrawn by their owning Registered Account',
        );
      }
      if (options.action === 'pattern.remove' && pattern.creatorProfileId !== null) {
        throw new BadRequestException(
          'Community Patterns can only be removed through Post-Publication Review',
        );
      }
      if (pattern.status === 'review_hold') {
        throw new BadRequestException(
          'Review Hold must be resolved through the Post-Publication Review',
        );
      }
      if (options.to === 'available' && pattern.creatorProfileId !== null) {
        const ownerWithdrawal = await manager
          .getRepository(CatalogWithdrawalEntity)
          .findOneBy({ communityPatternId: pattern.id });
        if (ownerWithdrawal !== null) {
          throw new BadRequestException(
            'Catalog Withdrawal is irreversible for a Community Pattern',
          );
        }
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
    return this.formatStaffPicks(picks);
  }

  private async writeStaffPickOrder(
    manager: EntityManager,
    patternIds: string[],
  ): Promise<void> {
    const staffPickRepository = manager.getRepository(StaffPickEntity);
    await staffPickRepository.createQueryBuilder().delete().execute();
    if (patternIds.length > 0) {
      await staffPickRepository.save(
        patternIds.map((patternId, index) =>
          staffPickRepository.create({ patternId, position: index + 1 }),
        ),
      );
    }
  }

  private formatStaffPicks(
    picks: Pick<StaffPickEntity, 'pattern' | 'patternId' | 'position'>[],
  ): { patternId: string; title: string; creatorName: string; position: number }[] {
    return picks
      .filter((pick) => pick.pattern !== null && pick.pattern !== undefined)
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
      patternType: pattern.creatorProfileId === null ? 'official' : 'community',
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
