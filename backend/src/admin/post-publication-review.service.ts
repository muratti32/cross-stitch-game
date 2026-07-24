import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';

import { AuthIdentityEntity } from '../auth/entities';
import { EmailOutboxEntity } from '../auth/email-outbox.entity';
import {
  CommunityReportEntity,
  ModerationNoticeEntity,
  PatternEntity,
  PostPublicationReviewEntity,
} from '../catalog/entities';
import {
  OBJECT_STORAGE,
  ObjectStorage,
} from '../catalog/storage/object-storage.interface';
import { CreatorProfileEntity } from '../creator-profile/entities';
import { OperatorAuditLogService } from './operator-audit-log.service';

@Injectable()
export class PostPublicationReviewService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly auditLog: OperatorAuditLogService,
  ) {}

  async listOpen() {
    const reviews = await this.dataSource
      .getRepository(PostPublicationReviewEntity)
      .find({ order: { createdAt: 'ASC' }, where: { status: 'open' } });
    if (reviews.length === 0) return [];

    const reviewIds = reviews.map((review) => review.id);
    const [patterns, reportCounts] = await Promise.all([
      this.dataSource.getRepository(PatternEntity).findBy({
        id: In(reviews.map((review) => review.communityPatternId)),
      }),
      this.dataSource
        .getRepository(CommunityReportEntity)
        .createQueryBuilder('report')
        .select('report.reviewId', 'reviewId')
        .addSelect('COUNT(report.id)', 'count')
        .where('report.reviewId IN (:...reviewIds)', { reviewIds })
        .groupBy('report.reviewId')
        .getRawMany<{ count: string; reviewId: string }>(),
    ]);
    const patternById = new Map(patterns.map((pattern) => [pattern.id, pattern]));
    const countByReview = new Map(
      reportCounts.map((row) => [row.reviewId, Number.parseInt(row.count, 10)]),
    );

    return reviews.map((review) => {
      const pattern = patternById.get(review.communityPatternId);
      if (pattern === undefined) {
        throw new Error(`Post-Publication Review ${review.id} has no Pattern`);
      }
      return this.listView(review, pattern, countByReview.get(review.id) ?? 0);
    });
  }

  async get(id: string) {
    const review = await this.dataSource
      .getRepository(PostPublicationReviewEntity)
      .findOneBy({ id });
    if (review === null) {
      throw new NotFoundException('Post-Publication Review not found');
    }
    return this.detailView(review);
  }

  async applyHold(
    operatorAccountId: string,
    id: string,
    rawReason: string,
    requestId: string | null,
  ) {
    const reason = normalizeReason(rawReason);
    if (reason.length === 0 || reason.length > 2000) {
      throw new ConflictException('Review Hold reason is required');
    }

    return this.dataSource.transaction(async (manager) => {
      const reviews = manager.getRepository(PostPublicationReviewEntity);
      const review = await reviews.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id },
      });
      if (review === null) {
        throw new NotFoundException('Post-Publication Review not found');
      }
      if (review.status !== 'open') {
        throw new ConflictException('Post-Publication Review is closed');
      }

      const patterns = manager.getRepository(PatternEntity);
      const pattern = await patterns.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: review.communityPatternId },
      });
      if (pattern === null || pattern.creatorProfileId === null) {
        throw new ConflictException('Community Pattern is unavailable');
      }

      if (review.holdAppliedAt !== null) {
        const notice = await manager.getRepository(ModerationNoticeEntity).findOneBy({
          noticeType: 'review_hold',
          reviewId: review.id,
        });
        if (notice === null || pattern.status !== 'review_hold') {
          throw new Error(`Review Hold ${review.id} has inconsistent persisted state`);
        }
        const email = await manager.getRepository(EmailOutboxEntity).findOneBy({
          dedupeKey: `moderation_notice:${notice.id}`,
        });
        return this.holdView(review, notice, false, email !== null);
      }
      if (pattern.status !== 'available') {
        throw new ConflictException('Community Pattern is unavailable');
      }

      const profile = await manager.getRepository(CreatorProfileEntity).findOneBy({
        id: pattern.creatorProfileId,
      });
      if (profile === null) {
        throw new Error(`Community Pattern ${pattern.id} has no creator profile`);
      }
      const emailIdentity = await manager
        .getRepository(AuthIdentityEntity)
        .createQueryBuilder('identity')
        .where('identity.accountId = :accountId', { accountId: profile.accountId })
        .andWhere('identity.email IS NOT NULL')
        .orderBy("CASE WHEN identity.provider = 'email' THEN 0 ELSE 1 END", 'ASC')
        .addOrderBy('identity.createdAt', 'ASC')
        .addOrderBy('identity.id', 'ASC')
        .getOne();

      const before = {
        patternStatus: pattern.status,
        reviewHoldAppliedAt: review.holdAppliedAt,
      };
      const now = new Date();
      pattern.status = 'review_hold';
      await patterns.save(pattern);
      review.holdAppliedAt = now;
      review.holdOperatorAccountId = operatorAccountId;
      review.holdReason = reason;
      await reviews.save(review);

      const notices = manager.getRepository(ModerationNoticeEntity);
      const notice = await notices.save(
        notices.create({
          accountId: profile.accountId,
          communityPatternId: pattern.id,
          noticeType: 'review_hold',
          patternTitle: pattern.title,
          reason,
          reviewId: review.id,
        }),
      );

      let emailQueued = false;
      if (emailIdentity?.email !== null && emailIdentity?.email !== undefined) {
        const outbox = manager.getRepository(EmailOutboxEntity);
        await outbox.save(
          outbox.create({
            attempts: 0,
            dedupeKey: `moderation_notice:${notice.id}`,
            dispatchedAt: null,
            payload: {
              noticeId: notice.id,
              patternId: pattern.id,
              patternTitle: pattern.title,
              reason,
            },
            template: 'moderation_notice',
            toEmail: emailIdentity.email,
          }),
        );
        emailQueued = true;
      }

      await this.auditLog.record(manager, {
        action: 'post_publication_review.hold.apply',
        after: {
          emailQueued,
          moderationNoticeId: notice.id,
          patternStatus: pattern.status,
          reviewHoldAppliedAt: now,
          reviewHoldReason: reason,
        },
        before,
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: review.id,
        targetType: 'post_publication_review',
      });

      return this.holdView(review, notice, true, emailQueued);
    });
  }

  private async detailView(review: PostPublicationReviewEntity) {
    const [pattern, reports, notice] = await Promise.all([
      this.dataSource.getRepository(PatternEntity).findOne({
        relations: ['tags'],
        where: { id: review.communityPatternId },
      }),
      this.dataSource.getRepository(CommunityReportEntity).find({
        order: { createdAt: 'ASC' },
        where: { reviewId: review.id },
      }),
      this.dataSource.getRepository(ModerationNoticeEntity).findOneBy({
        noticeType: 'review_hold',
        reviewId: review.id,
      }),
    ]);
    if (pattern === null) {
      throw new Error(`Post-Publication Review ${review.id} has no Pattern`);
    }
    return {
      ...this.listView(review, pattern, reports.length),
      metadataRevisionId: review.metadataRevisionId,
      noticeId: notice?.id ?? null,
      pattern: {
        categoryCode: pattern.categoryCode,
        description: pattern.description,
        id: pattern.id,
        previewUrl: this.storage.publicUrl(pattern.previewObjectKey),
        sourceLanguage: pattern.sourceLanguage,
        status: pattern.status,
        tagCodes: pattern.tags.map((tag) => tag.code),
        title: pattern.title,
      },
      reports: reports.map((report) => ({
        createdAt: report.createdAt.toISOString(),
        explanation: report.explanation,
        id: report.id,
        reason: report.reason,
      })),
    };
  }

  private listView(
    review: PostPublicationReviewEntity,
    pattern: PatternEntity,
    reportCount: number,
  ) {
    return {
      holdAppliedAt: review.holdAppliedAt?.toISOString() ?? null,
      holdReason: review.holdReason,
      id: review.id,
      openedAt: review.createdAt.toISOString(),
      patternId: pattern.id,
      patternStatus: pattern.status,
      patternTitle: pattern.title,
      reportCount,
      status: review.status,
    };
  }

  private holdView(
    review: PostPublicationReviewEntity,
    notice: ModerationNoticeEntity,
    applied: boolean,
    emailQueued = true,
  ) {
    return {
      applied,
      emailQueued,
      holdAppliedAt: review.holdAppliedAt!.toISOString(),
      moderationNoticeId: notice.id,
      patternId: review.communityPatternId,
      reason: review.holdReason,
      reviewId: review.id,
      status: 'review_hold' as const,
    };
  }
}

function normalizeReason(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}
