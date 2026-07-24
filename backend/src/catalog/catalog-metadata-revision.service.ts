import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { CreatorProfileEntity } from '../creator-profile/entities';
import { CatalogPrecheckService } from './catalog-precheck.service';
import { CreateCatalogMetadataRevisionDto } from './dto/create-catalog-metadata-revision.dto';
import { CatalogMetadataRevisionEntity, PatternEntity } from './entities';

const ACTIVE_SLOT_STATUSES = ['pending', 'appeal_pending'] as const;

@Injectable()
export class CatalogMetadataRevisionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly precheck: CatalogPrecheckService,
  ) {}

  async create(principal: AuthPrincipal, patternId: string, dto: CreateCatalogMetadataRevisionDto) {
    const accountId = this.requireAccount(principal);
    const profile = await this.dataSource.getRepository(CreatorProfileEntity).findOneBy({ accountId });
    if (profile === null) throw new ConflictException('Create a Public Creator Profile before revising Catalog Metadata');

    const pattern = await this.dataSource.getRepository(PatternEntity).findOneBy({
      creatorProfileId: profile.id,
      id: patternId,
      status: 'available',
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

  async myPatterns(principal: AuthPrincipal) {
    const accountId = this.requireAccount(principal);
    const profile = await this.dataSource.getRepository(CreatorProfileEntity).findOneBy({ accountId });
    if (profile === null) return [];
    const patterns = await this.dataSource.getRepository(PatternEntity).find({
      order: { publishedAt: 'DESC' },
      relations: ['tags'],
      where: { creatorProfileId: profile.id, status: 'available', visibility: 'catalog' },
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
        canSubmitRevision: !hasActiveSlot,
        categoryCode: pattern.categoryCode,
        description: pattern.description,
        id: pattern.id,
        latestRevision: latest === null ? null : this.ownerView(latest),
        publishedAt: pattern.publishedAt.toISOString(),
        sourceLanguage: pattern.sourceLanguage,
        tagCodes: (pattern.tags ?? []).map((tag) => tag.code),
        title: pattern.title,
      };
    });
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
