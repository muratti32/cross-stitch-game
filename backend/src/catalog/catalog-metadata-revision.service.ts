import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In, MoreThan, Not } from 'typeorm';

import { OperatorAuditLogEntity } from '../admin/entities';
import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { CreatorProfileEntity } from '../creator-profile/entities';
import { CatalogPrecheckService } from './catalog-precheck.service';
import { CreateCatalogMetadataAppealDto } from './dto/create-catalog-metadata-appeal.dto';
import { CreateCatalogMetadataRevisionDto } from './dto/create-catalog-metadata-revision.dto';
import {
  CategoryEntity,
  CatalogMetadataAppealEntity,
  CatalogMetadataRevisionEntity,
  CatalogMetadataReviewDecisionEntity,
  CatalogRejectionReason,
  PatternEntity,
  TagEntity,
} from './entities';
import { OBJECT_STORAGE, ObjectStorage } from './storage/object-storage.interface';
import { patternImageUrls } from './pattern-image-urls';

const ACTIVE_SLOT_STATUSES = ['pending', 'appeal_pending'] as const;

@Injectable()
export class CatalogMetadataRevisionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly precheck: CatalogPrecheckService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async create(principal: AuthPrincipal, patternId: string, dto: CreateCatalogMetadataRevisionDto) {
    const accountId = this.requireAccount(principal);
    const profile = await this.dataSource.getRepository(CreatorProfileEntity).findOneBy({ accountId });
    if (profile === null) throw new ConflictException('Create a Public Creator Profile before revising Catalog Metadata');

    const pattern = await this.dataSource.getRepository(PatternEntity).findOneBy({
      creatorProfileId: profile.id,
      id: patternId,
      status: In(['available', 'review_hold']),
      visibility: 'catalog',
    });
    if (pattern === null) throw new NotFoundException('Community Pattern not found');

    const title = normalizeText(dto.title);
    const description = normalizeText(dto.description);
    if (title.length < 1 || title.length > 120 || description.length < 1 || description.length > 2000) {
      throw new ConflictException('Catalog Metadata Revision text is outside the allowed length');
    }
    const tagCodes = [...dto.tagCodes].sort();

    const [metadataErrors, moderationEvidence] = await Promise.all([
      this.precheck.validateMetadataFields({
        categoryCode: dto.categoryCode,
        description,
        sourceLanguage: dto.sourceLanguage,
        tagCodes,
        title,
      }),
      this.precheck.moderateText(title, description),
    ]);
    const metadataValid = metadataErrors.length === 0 && moderationEvidence.flagged !== true;

    return this.dataSource.transaction(async (manager) => {
      const lockedPattern = await manager.getRepository(PatternEntity).findOne({
        lock: { mode: 'pessimistic_write' },
        where: {
          creatorProfileId: profile.id,
          id: patternId,
          status: In(['available', 'review_hold']),
          visibility: 'catalog',
        },
      });
      if (lockedPattern === null) throw new NotFoundException('Community Pattern not found');
      const existing = await manager.getRepository(CatalogMetadataRevisionEntity).findOneBy({
        communityPatternId: patternId,
        status: In([...ACTIVE_SLOT_STATUSES]),
      });
      if (existing !== null) {
        throw new ConflictException('A Catalog Metadata Revision is already pending or under appeal for this Pattern');
      }
      const revision = await manager.getRepository(CatalogMetadataRevisionEntity).save({
        accountId,
        categoryCode: dto.categoryCode,
        communityPatternId: patternId,
        creatorProfileId: profile.id,
        description,
        metadataErrors,
        metadataValid,
        moderationEvidence,
        sourceLanguage: dto.sourceLanguage,
        status: 'pending',
        tagCodes,
        title,
      });
      return this.ownerView(revision);
    });
  }

  async listMine(principal: AuthPrincipal) {
    const accountId = this.requireAccount(principal);
    const revisions = await this.dataSource.getRepository(CatalogMetadataRevisionEntity).find({
      order: { createdAt: 'DESC' },
      where: { accountId },
    });
    return revisions.map((revision) => this.ownerView(revision));
  }

  async getMine(principal: AuthPrincipal, id: string) {
    const accountId = this.requireAccount(principal);
    const revision = await this.dataSource.getRepository(CatalogMetadataRevisionEntity).findOneBy({ accountId, id });
    if (revision === null) throw new NotFoundException('Catalog Metadata Revision not found');
    return this.ownerView(revision);
  }

  async withdraw(principal: AuthPrincipal, id: string) {
    const accountId = this.requireAccount(principal);
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CatalogMetadataRevisionEntity);
      const revision = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { accountId, id },
      });
      if (revision === null) throw new NotFoundException('Catalog Metadata Revision not found');
      if (!(ACTIVE_SLOT_STATUSES as readonly string[]).includes(revision.status)) {
        throw new ConflictException('Only a pending revision or active appeal can be withdrawn');
      }
      revision.status = 'withdrawn';
      await repository.save(revision);
      return this.ownerView(revision);
    });
  }

  async appeal(principal: AuthPrincipal, id: string, dto: CreateCatalogMetadataAppealDto) {
    const accountId = this.requireAccount(principal);
    const snapshot = await this.dataSource.getRepository(CatalogMetadataRevisionEntity).findOneBy({ accountId, id });
    if (snapshot === null) throw new NotFoundException('Catalog Metadata Revision not found');
    if (snapshot.status !== 'rejected') {
      throw new ConflictException('Only an initially rejected revision can be appealed');
    }
    const waived = await this.dataSource.getRepository(CatalogMetadataRevisionEntity).findOneBy({
      communityPatternId: snapshot.communityPatternId,
      createdAt: MoreThan(snapshot.createdAt),
      id: Not(snapshot.id),
    });
    if (waived !== null) {
      throw new ConflictException('The appeal right for this revision was waived by a later revision');
    }
    return this.dataSource.transaction(async (manager) => {
      const pattern = await manager.getRepository(PatternEntity).findOne({
        lock: { mode: 'pessimistic_write' },
        where: {
          creatorProfileId: snapshot.creatorProfileId,
          id: snapshot.communityPatternId,
          status: In(['available', 'review_hold']),
          visibility: 'catalog',
        },
      });
      if (pattern === null) throw new ConflictException('Community Pattern is unavailable');
      const repository = manager.getRepository(CatalogMetadataRevisionEntity);
      const revision = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { accountId, id },
      });
      if (revision === null) throw new NotFoundException('Catalog Metadata Revision not found');
      if (revision.status !== 'rejected') {
        throw new ConflictException('Only an initially rejected revision can be appealed');
      }
      const laterRevision = await manager.getRepository(CatalogMetadataRevisionEntity).findOneBy({
        communityPatternId: revision.communityPatternId,
        createdAt: MoreThan(revision.createdAt),
        id: Not(revision.id),
      });
      if (laterRevision !== null) {
        throw new ConflictException('The appeal right for this revision was waived by a later revision');
      }
      const existing = await manager.getRepository(CatalogMetadataAppealEntity).findOneBy({ revisionId: id });
      if (existing !== null) throw new ConflictException('This Catalog Metadata Revision has already used its appeal');
      const appeal = await manager.getRepository(CatalogMetadataAppealEntity).save({
        accountId,
        note: dto.note?.trim() || null,
        revisionId: id,
      });
      revision.status = 'appeal_pending';
      await repository.save(revision);
      return { createdAt: appeal.createdAt.toISOString(), id: appeal.id, revisionId: id };
    });
  }

  async myPatterns(principal: AuthPrincipal) {
    const accountId = this.requireAccount(principal);
    const profile = await this.dataSource.getRepository(CreatorProfileEntity).findOneBy({ accountId });
    if (profile === null) return [];
    const patterns = await this.dataSource.getRepository(PatternEntity).find({
      order: { publishedAt: 'DESC' },
      relations: ['tags'],
      where: {
        creatorProfileId: profile.id,
        status: In(['available', 'review_hold', 'withdrawn']),
        visibility: 'catalog',
      },
    });
    if (patterns.length === 0) return [];
    const revisions = await this.dataSource.getRepository(CatalogMetadataRevisionEntity).find({
      order: { createdAt: 'DESC' },
      where: { communityPatternId: In(patterns.map((pattern) => pattern.id)) },
    });
    const latestByPattern = new Map<string, CatalogMetadataRevisionEntity>();
    for (const revision of revisions) {
      if (!latestByPattern.has(revision.communityPatternId)) {
        latestByPattern.set(revision.communityPatternId, revision);
      }
    }
    return patterns.map((pattern) => {
      const latest = latestByPattern.get(pattern.id) ?? null;
      const hasActiveSlot = latest !== null && (ACTIVE_SLOT_STATUSES as readonly string[]).includes(latest.status);
      return {
        canSubmitRevision:
          (pattern.status === 'available' || pattern.status === 'review_hold') &&
          !hasActiveSlot,
        categoryCode: pattern.categoryCode,
        description: pattern.description,
        id: pattern.id,
        latestRevision: latest === null ? null : this.ownerView(latest),
        publishedAt: pattern.publishedAt.toISOString(),
        sourceLanguage: pattern.sourceLanguage,
        status: pattern.status,
        tagCodes: (pattern.tags ?? []).map((tag) => tag.code),
        title: pattern.title,
        ...patternImageUrls(pattern, this.storage),
      };
    });
  }

  async listForReview(status?: string) {
    const allowed = ['pending', 'appeal_pending'];
    const statuses = status === undefined ? allowed : allowed.includes(status) ? [status] : [];
    if (statuses.length === 0) throw new BadRequestException('Unknown Catalog Metadata Revision review status');
    const revisions = await this.dataSource.getRepository(CatalogMetadataRevisionEntity)
      .createQueryBuilder('revision')
      .where('revision.status IN (:...statuses)', { statuses })
      .orderBy('revision.createdAt', 'ASC')
      .getMany();
    return revisions.map((revision) => this.reviewView(revision));
  }

  async getForReview(id: string) {
    const revision = await this.dataSource.getRepository(CatalogMetadataRevisionEntity).findOneBy({ id });
    if (revision === null) throw new NotFoundException('Catalog Metadata Revision not found');
    const [pattern, appeal, decisions] = await Promise.all([
      this.dataSource.getRepository(PatternEntity).findOne({
        relations: ['tags'],
        where: { id: revision.communityPatternId },
      }),
      this.dataSource.getRepository(CatalogMetadataAppealEntity).findOneBy({ revisionId: id }),
      this.dataSource.getRepository(CatalogMetadataReviewDecisionEntity).find({
        order: { createdAt: 'ASC' },
        where: { revisionId: id },
      }),
    ]);
    return {
      ...this.reviewView(revision),
      appeal: appeal === null ? null : { createdAt: appeal.createdAt.toISOString(), note: appeal.note },
      currentPattern: pattern === null ? null : {
        categoryCode: pattern.categoryCode,
        description: pattern.description,
        publishedAt: pattern.publishedAt.toISOString(),
        sourceLanguage: pattern.sourceLanguage,
        tagCodes: pattern.tags.map((tag) => tag.code),
        title: pattern.title,
      },
      decisions: decisions.map((decision) => ({
        createdAt: decision.createdAt.toISOString(),
        decision: decision.decision,
        note: decision.note,
        operatorAccountId: decision.operatorAccountId,
        rejectionReason: decision.rejectionReason,
        reviewRound: decision.reviewRound,
      })),
    };
  }

  async accept(
    operatorAccountId: string,
    id: string,
    note?: string,
    requestId: string | null = null,
  ) {
    const snapshot = await this.dataSource.getRepository(CatalogMetadataRevisionEntity).findOneBy({ id });
    if (snapshot === null) throw new NotFoundException('Catalog Metadata Revision not found');
    if (snapshot.status === 'accepted') return this.reviewView(snapshot);
    this.reviewRound(snapshot.status);
    const [metadataErrors, moderationEvidence] = await Promise.all([
      this.precheck.validateMetadataFields({
        categoryCode: snapshot.categoryCode,
        description: snapshot.description,
        sourceLanguage: snapshot.sourceLanguage,
        tagCodes: snapshot.tagCodes,
        title: snapshot.title,
      }),
      this.precheck.moderateText(snapshot.title, snapshot.description),
    ]);
    if (metadataErrors.length > 0 || moderationEvidence.flagged === true) {
      throw new ConflictException('Invalid Catalog Metadata Revision cannot be accepted');
    }
    return this.dataSource.transaction(async (manager) => {
      const revisions = manager.getRepository(CatalogMetadataRevisionEntity);
      const revision = await revisions.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id },
      });
      if (revision === null) throw new NotFoundException('Catalog Metadata Revision not found');
      if (revision.status === 'accepted') return this.reviewView(revision);
      const reviewRound = this.reviewRound(revision.status);
      const pattern = await manager.getRepository(PatternEntity).findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: revision.communityPatternId },
      });
      if (
        pattern === null ||
        (pattern.status !== 'available' && pattern.status !== 'review_hold')
      ) {
        throw new ConflictException('Community Pattern is unavailable');
      }
      const category = await manager.getRepository(CategoryEntity).findOneBy({
        active: true,
        code: revision.categoryCode,
      });
      if (category === null) throw new ConflictException('Invalid Catalog Metadata Revision cannot be accepted');
      const tags = revision.tagCodes.length === 0
        ? []
        : await manager.getRepository(TagEntity).findBy({ active: true, code: In(revision.tagCodes) });
      if (tags.length !== revision.tagCodes.length) {
        throw new ConflictException('Invalid Catalog Metadata Revision cannot be accepted');
      }
      const before = this.auditView(revision);
      pattern.title = revision.title;
      pattern.description = revision.description;
      pattern.sourceLanguage = revision.sourceLanguage;
      pattern.categoryCode = revision.categoryCode;
      await manager.getRepository(PatternEntity).save(pattern);
      await manager.query('DELETE FROM catalog.pattern_tags WHERE pattern_id = $1', [pattern.id]);
      if (tags.length > 0) {
        await manager.createQueryBuilder()
          .relation(PatternEntity, 'tags')
          .of(pattern.id)
          .add(tags.map((tag) => tag.code));
      }
      await manager.getRepository(CatalogMetadataReviewDecisionEntity).save({
        decision: 'accepted',
        note: note?.trim() || null,
        operatorAccountId,
        rejectionReason: null,
        reviewRound,
        revisionId: id,
      });
      revision.metadataErrors = metadataErrors;
      revision.metadataValid = true;
      revision.status = 'accepted';
      if (reviewRound === 'initial') revision.initialModeratorId = operatorAccountId;
      await revisions.save(revision);
      await this.recordDecisionAudit(manager, {
        action: reviewRound === 'initial' ? 'catalog_metadata_revision.accept' : 'catalog_metadata_revision.appeal.accept',
        after: this.auditView(revision),
        before,
        id,
        operatorAccountId,
        requestId,
      });
      return this.reviewView(revision);
    });
  }

  async reject(
    operatorAccountId: string,
    id: string,
    reason: CatalogRejectionReason,
    note?: string,
    requestId: string | null = null,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CatalogMetadataRevisionEntity);
      const revision = await repository.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id },
      });
      if (revision === null) throw new NotFoundException('Catalog Metadata Revision not found');
      const reviewRound = this.reviewRound(revision.status);
      const before = this.auditView(revision);
      await manager.getRepository(CatalogMetadataReviewDecisionEntity).save({
        decision: 'rejected',
        note: note?.trim() || null,
        operatorAccountId,
        rejectionReason: reason,
        reviewRound,
        revisionId: id,
      });
      revision.rejectionNote = note?.trim() || null;
      revision.rejectionReason = reason;
      revision.status = reviewRound === 'initial' ? 'rejected' : 'appeal_upheld';
      if (reviewRound === 'initial') revision.initialModeratorId = operatorAccountId;
      await repository.save(revision);
      await this.recordDecisionAudit(manager, {
        action: reviewRound === 'initial' ? 'catalog_metadata_revision.reject' : 'catalog_metadata_revision.appeal.reject',
        after: this.auditView(revision),
        before,
        id,
        operatorAccountId,
        requestId,
      });
      return this.reviewView(revision);
    });
  }

  private reviewRound(status: string): 'initial' | 'appeal' {
    if (status === 'pending') return 'initial';
    if (status === 'appeal_pending') return 'appeal';
    throw new ConflictException('Catalog Metadata Revision is not awaiting human review');
  }

  private auditView(revision: CatalogMetadataRevisionEntity) {
    return {
      rejectionNote: revision.rejectionNote,
      rejectionReason: revision.rejectionReason,
      status: revision.status,
    };
  }

  private async recordDecisionAudit(
    manager: import('typeorm').EntityManager,
    input: {
      action: string;
      after: ReturnType<CatalogMetadataRevisionService['auditView']>;
      before: ReturnType<CatalogMetadataRevisionService['auditView']>;
      id: string;
      operatorAccountId: string;
      requestId: string | null;
    },
  ): Promise<void> {
    await manager.getRepository(OperatorAuditLogEntity).save({
      action: input.action,
      after: input.after,
      before: input.before,
      operatorAccountId: input.operatorAccountId,
      outcome: 'success',
      requestId: input.requestId,
      targetId: input.id,
      targetType: 'catalog_metadata_revision',
    });
  }

  private reviewView(revision: CatalogMetadataRevisionEntity) {
    return {
      ...this.ownerView(revision),
      accountId: revision.accountId,
      creatorProfileId: revision.creatorProfileId,
      initialModeratorId: revision.initialModeratorId,
    };
  }

  private ownerView(revision: CatalogMetadataRevisionEntity) {
    return {
      categoryCode: revision.categoryCode,
      communityPatternId: revision.communityPatternId,
      createdAt: revision.createdAt.toISOString(),
      description: revision.description,
      id: revision.id,
      metadataErrors: revision.metadataErrors ?? [],
      metadataValid: revision.metadataValid,
      rejectionNote: revision.rejectionNote,
      rejectionReason: revision.rejectionReason,
      sourceLanguage: revision.sourceLanguage,
      status: revision.status,
      tagCodes: revision.tagCodes,
      title: revision.title,
      updatedAt: revision.updatedAt.toISOString(),
    };
  }

  private requireAccount(principal: AuthPrincipal): string {
    if (principal.type !== PrincipalType.Account) throw new ForbiddenException('Registered Account required');
    return principal.id;
  }
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}
