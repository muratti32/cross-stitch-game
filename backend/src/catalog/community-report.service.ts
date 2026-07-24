import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { CreateCommunityReportDto } from './dto/create-community-report.dto';
import {
  CatalogMetadataRevisionEntity,
  CommunityReportEntity,
  PatternEntity,
  PostPublicationReviewEntity,
} from './entities';

export const COMMUNITY_REPORT_REOPEN_COOLDOWN_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class CommunityReportService {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    principal: AuthPrincipal,
    patternId: string,
    dto: CreateCommunityReportDto,
  ) {
    const accountId = this.requireAccount(principal);
    const explanation = normalizeOptionalText(dto.explanation);
    if (dto.reason === 'other' && explanation === null) {
      throw new BadRequestException('Other reports require an explanation');
    }
    const evidenceDigest = explanation === null ? null : digestEvidence(explanation);
    if (explanation !== null && evidenceDigest === null) {
      throw new BadRequestException('Explanation must include letters or numbers');
    }

    return this.dataSource.transaction(async (manager) => {
      const pattern = await manager.getRepository(PatternEntity).findOne({
        lock: { mode: 'pessimistic_write' },
        where: {
          id: patternId,
          status: 'available',
          visibility: 'catalog',
        },
      });
      if (pattern === null || pattern.creatorProfileId === null) {
        throw new NotFoundException('Published Community Pattern not found');
      }

      const reviews = manager.getRepository(PostPublicationReviewEntity);
      let review = await reviews.findOneBy({
        communityPatternId: patternId,
        status: 'open',
      });

      if (review !== null) {
        const existing = await manager.getRepository(CommunityReportEntity).findOneBy({
          reporterAccountId: accountId,
          reviewId: review.id,
        });
        if (existing !== null) return this.response(existing, review, false);
      } else {
        const latestClosedReview = await reviews.findOne({
          order: { createdAt: 'DESC' },
          where: { communityPatternId: patternId, status: 'closed' },
        });
        const metadataRevisionId = await this.currentMetadataRevisionId(manager, patternId);

        if (latestClosedReview !== null) {
          await this.assertReopenAllowed(manager, {
            accountId,
            evidenceDigest,
            latestClosedReview,
            metadataRevisionId,
            patternId,
          });
        }

        review = await reviews.save({
          closedAt: null,
          communityPatternId: patternId,
          metadataRevisionId,
          status: 'open',
        });
      }

      const report = await manager.getRepository(CommunityReportEntity).save({
        evidenceDigest,
        explanation,
        reason: dto.reason,
        reporterAccountId: accountId,
        reviewId: review.id,
      });
      return this.response(report, review, true);
    });
  }

  private async assertReopenAllowed(
    manager: EntityManager,
    input: {
      accountId: string;
      evidenceDigest: string | null;
      latestClosedReview: PostPublicationReviewEntity;
      metadataRevisionId: string | null;
      patternId: string;
    },
  ): Promise<void> {
    const reports = manager.getRepository(CommunityReportEntity);
    const latestReport = await reports
      .createQueryBuilder('report')
      .innerJoin(
        PostPublicationReviewEntity,
        'review',
        'review.id = report.review_id',
      )
      .where('review.community_pattern_id = :patternId', {
        patternId: input.patternId,
      })
      .andWhere('report.reporter_account_id = :accountId', {
        accountId: input.accountId,
      })
      .orderBy('report.created_at', 'DESC')
      .getOne();

    if (
      latestReport !== null &&
      latestReport.createdAt.getTime() > Date.now() - COMMUNITY_REPORT_REOPEN_COOLDOWN_MS
    ) {
      throw new ConflictException('A closed Community Report can be reopened once every 24 hours');
    }

    const metadataChanged =
      input.latestClosedReview.metadataRevisionId !== input.metadataRevisionId;
    if (metadataChanged) return;

    if (input.evidenceDigest === null) {
      throw new ConflictException(
        'Reopening requires newly approved metadata or materially new evidence',
      );
    }

    const repeatedEvidence = await reports
      .createQueryBuilder('report')
      .innerJoin(
        PostPublicationReviewEntity,
        'review',
        'review.id = report.review_id',
      )
      .where('review.community_pattern_id = :patternId', {
        patternId: input.patternId,
      })
      .andWhere('report.reporter_account_id = :accountId', {
        accountId: input.accountId,
      })
      .andWhere('report.evidence_digest = :evidenceDigest', {
        evidenceDigest: input.evidenceDigest,
      })
      .getOne();
    if (repeatedEvidence !== null) {
      throw new ConflictException(
        'Reopening requires newly approved metadata or materially new evidence',
      );
    }
  }

  private async currentMetadataRevisionId(
    manager: EntityManager,
    patternId: string,
  ): Promise<string | null> {
    const revision = await manager.getRepository(CatalogMetadataRevisionEntity).findOne({
      order: { createdAt: 'DESC' },
      select: { id: true },
      where: { communityPatternId: patternId, status: 'accepted' },
    });
    return revision?.id ?? null;
  }

  private requireAccount(principal: AuthPrincipal): string {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('Registered Account required');
    }
    return principal.id;
  }

  private response(
    report: CommunityReportEntity,
    review: PostPublicationReviewEntity,
    created: boolean,
  ) {
    return {
      created,
      report: {
        createdAt: report.createdAt.toISOString(),
        explanation: report.explanation,
        id: report.id,
        reason: report.reason,
        reviewId: report.reviewId,
      },
      review: {
        id: review.id,
        openedAt: review.createdAt.toISOString(),
        status: review.status,
      },
    };
  }
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return normalized.length === 0 ? null : normalized;
}

function digestEvidence(value: string): string | null {
  const canonical = value
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (canonical.length === 0) return null;
  return createHash('sha256').update(canonical).digest('hex');
}
