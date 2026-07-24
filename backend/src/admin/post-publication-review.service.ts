import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import { AuthIdentityEntity } from '../auth/entities';
import { EmailOutboxEntity } from '../auth/email-outbox.entity';
import {
  CatalogMetadataAppealEntity,
  CatalogMetadataRevisionEntity,
  CategoryEntity,
  CommunityReportEntity,
  ModerationNoticeEntity,
  ModerationNoticeType,
  PatternEntity,
  PostPublicationReviewClosureEntity,
  PostPublicationReviewEntity,
} from '../catalog/entities';
import {
  OBJECT_STORAGE,
  ObjectStorage,
} from '../catalog/storage/object-storage.interface';
import {
  previewContentType,
  safetyRemovalPreviewArchiveKey,
} from '../catalog/catalog.utils';
import { CreatorProfileEntity } from '../creator-profile/entities';
import { OperatorAuditLogService } from './operator-audit-log.service';

const ACTIVE_REVISION_STATUSES = ['pending', 'appeal_pending'] as const;

// Catalog Metadata Remediation mirrors Profile Remediation: title and
// description are replaced with a fixed safe default rather than a
// moderator-authored value, so the outcome never depends on a moderator's
// own wording. The owner can still submit an ordinary Catalog Metadata
// Revision afterward to propose compliant values.
const REMEDIATED_TITLE = 'Community Pattern';

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

      const { notice, emailQueued } = await this.createOwnerNotice(manager, {
        noticeType: 'review_hold',
        pattern,
        reason,
        reviewId: review.id,
      });

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

  async closeNoViolation(
    operatorAccountId: string,
    id: string,
    rawReason: string,
    requestId: string | null,
  ) {
    const reason = normalizeReason(rawReason);
    if (reason.length === 0 || reason.length > 2000) {
      throw new ConflictException('Close reason is required');
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
      if (review.status === 'closed') {
        return this.idempotentCloseView(manager, review, 'no_violation');
      }

      const patterns = manager.getRepository(PatternEntity);
      const pattern = await patterns.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: review.communityPatternId },
      });
      if (pattern === null || pattern.creatorProfileId === null) {
        throw new ConflictException('Community Pattern is unavailable');
      }
      if (pattern.status !== 'available' && pattern.status !== 'review_hold') {
        throw new ConflictException('Community Pattern is unavailable');
      }

      const before = { patternStatus: pattern.status, reviewStatus: review.status };
      pattern.status = 'available';
      await patterns.save(pattern);

      const closedRecords = await this.closePendingMetadataWork(
        manager,
        review.id,
        pattern.id,
      );

      review.status = 'closed';
      review.closedAt = new Date();
      review.closeOutcome = 'no_violation';
      review.closeOperatorAccountId = operatorAccountId;
      review.closeReason = reason;
      await reviews.save(review);

      const { notice, emailQueued } = await this.createOwnerNotice(manager, {
        noticeType: 'no_violation',
        pattern,
        reason,
        reviewId: review.id,
      });

      await this.auditLog.record(manager, {
        action: 'post_publication_review.close.no_violation',
        after: {
          closedRecords,
          emailQueued,
          moderationNoticeId: notice.id,
          patternStatus: pattern.status,
          reviewStatus: review.status,
        },
        before,
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: review.id,
        targetType: 'post_publication_review',
      });

      return this.closeView(review, notice, true, emailQueued);
    });
  }

  async applyRemediation(
    operatorAccountId: string,
    id: string,
    dto: { categoryCode?: string; reason: string; removeTagCodes: string[] },
    requestId: string | null,
  ) {
    const reason = normalizeReason(dto.reason);
    if (reason.length === 0 || reason.length > 2000) {
      throw new ConflictException('Remediation reason is required');
    }
    const removeTagCodes = new Set(
      dto.removeTagCodes.map((code) => code.trim()).filter((code) => code.length > 0),
    );

    return this.dataSource.transaction(async (manager) => {
      const reviews = manager.getRepository(PostPublicationReviewEntity);
      const review = await reviews.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id },
      });
      if (review === null) {
        throw new NotFoundException('Post-Publication Review not found');
      }
      if (review.status === 'closed') {
        return this.idempotentCloseView(manager, review, 'metadata_remediation');
      }

      const patterns = manager.getRepository(PatternEntity);
      const pattern = await patterns.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: review.communityPatternId },
      });
      if (pattern === null || pattern.creatorProfileId === null) {
        throw new ConflictException('Community Pattern is unavailable');
      }
      if (pattern.status !== 'available' && pattern.status !== 'review_hold') {
        throw new ConflictException('Community Pattern is unavailable');
      }

      let categoryCode = pattern.categoryCode;
      if (dto.categoryCode !== undefined && dto.categoryCode !== pattern.categoryCode) {
        const category = await manager.getRepository(CategoryEntity).findOneBy({
          active: true,
          code: dto.categoryCode,
        });
        if (category === null) {
          throw new ConflictException('Invalid category for Catalog Metadata Remediation');
        }
        categoryCode = category.code;
      }

      const currentTagRows = await manager.query<{ tag_code: string }[]>(
        'SELECT tag_code FROM catalog.pattern_tags WHERE pattern_id = $1',
        [pattern.id],
      );
      const currentTagCodes = currentTagRows.map((row) => row.tag_code);
      const invalidRemovals = [...removeTagCodes].filter(
        (code) => !currentTagCodes.includes(code),
      );
      if (invalidRemovals.length > 0) {
        throw new ConflictException('Cannot remove a tag that is not on this Community Pattern');
      }
      const remainingTagCodes = currentTagCodes.filter((code) => !removeTagCodes.has(code));

      const patternSnapshot = {
        creatorProfileId: pattern.creatorProfileId,
        id: pattern.id,
        title: pattern.title,
      };
      const before = {
        categoryCode: pattern.categoryCode,
        description: pattern.description,
        patternStatus: pattern.status,
        tagCodes: currentTagCodes,
        title: pattern.title,
      };

      pattern.status = 'available';
      pattern.title = REMEDIATED_TITLE;
      pattern.description = null;
      pattern.categoryCode = categoryCode;
      await patterns.save(pattern);
      await manager.query('DELETE FROM catalog.pattern_tags WHERE pattern_id = $1', [pattern.id]);
      if (remainingTagCodes.length > 0) {
        await manager
          .createQueryBuilder()
          .relation(PatternEntity, 'tags')
          .of(pattern.id)
          .add(remainingTagCodes);
      }

      const closedRecords = await this.closePendingMetadataWork(
        manager,
        review.id,
        pattern.id,
      );

      review.status = 'closed';
      review.closedAt = new Date();
      review.closeOutcome = 'metadata_remediation';
      review.closeOperatorAccountId = operatorAccountId;
      review.closeReason = reason;
      await reviews.save(review);

      const { notice, emailQueued } = await this.createOwnerNotice(manager, {
        noticeType: 'metadata_remediation',
        pattern: patternSnapshot,
        reason,
        reviewId: review.id,
      });

      await this.auditLog.record(manager, {
        action: 'post_publication_review.close.metadata_remediation',
        after: {
          categoryCode: pattern.categoryCode,
          closedRecords,
          description: pattern.description,
          emailQueued,
          moderationNoticeId: notice.id,
          patternStatus: pattern.status,
          removedTagCodes: [...removeTagCodes],
          tagCodes: remainingTagCodes,
          title: pattern.title,
        },
        before,
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: review.id,
        targetType: 'post_publication_review',
      });

      return this.closeView(review, notice, true, emailQueued);
    });
  }

  async applySafetyRemoval(
    operatorAccountId: string,
    id: string,
    rawReason: string,
    requestId: string | null,
  ) {
    const reason = normalizeReason(rawReason);
    if (reason.length === 0 || reason.length > 2000) {
      throw new ConflictException('Safety Removal reason is required');
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
      if (review.status === 'closed') {
        return this.idempotentCloseView(manager, review, 'safety_removal');
      }

      const patterns = manager.getRepository(PatternEntity);
      const pattern = await patterns.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: review.communityPatternId },
      });
      if (pattern === null || pattern.creatorProfileId === null) {
        throw new ConflictException('Community Pattern is unavailable');
      }
      if (pattern.status !== 'available' && pattern.status !== 'review_hold') {
        throw new ConflictException('Community Pattern is unavailable');
      }

      const before = { patternStatus: pattern.status, reviewStatus: review.status };
      pattern.status = 'removed';
      await patterns.save(pattern);

      // Purges the public Pattern Preview so it disappears from the CDN, after
      // archiving its bytes privately so an accepted Safety Removal Appeal can
      // republish the exact same preview. The private origin artifact stays in
      // storage for Safety Removal Appeal review; only the artifact grant path
      // (already gated on pattern status in SessionsService) controls access to
      // it going forward.
      const previewBytes = await this.storage.get(pattern.previewObjectKey);
      if (previewBytes !== null) {
        await this.storage.put(
          safetyRemovalPreviewArchiveKey(pattern.id, pattern.previewObjectKey),
          previewBytes,
          previewContentType(pattern.previewObjectKey),
        );
      }
      await this.storage.delete(pattern.previewObjectKey);

      const closedRecords = await this.closePendingMetadataWork(
        manager,
        review.id,
        pattern.id,
      );

      review.status = 'closed';
      review.closedAt = new Date();
      review.closeOutcome = 'safety_removal';
      review.closeOperatorAccountId = operatorAccountId;
      review.closeReason = reason;
      await reviews.save(review);

      const { notice, emailQueued } = await this.createOwnerNotice(manager, {
        noticeType: 'safety_removal',
        pattern,
        reason,
        reviewId: review.id,
      });

      await this.auditLog.record(manager, {
        action: 'post_publication_review.close.safety_removal',
        after: {
          closedRecords,
          emailQueued,
          moderationNoticeId: notice.id,
          patternStatus: pattern.status,
          reviewStatus: review.status,
        },
        before,
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: review.id,
        targetType: 'post_publication_review',
      });

      return this.closeView(review, notice, true, emailQueued);
    });
  }

  private async idempotentCloseView(
    manager: EntityManager,
    review: PostPublicationReviewEntity,
    expectedOutcome: NonNullable<PostPublicationReviewEntity['closeOutcome']>,
  ) {
    if (review.closeOutcome !== expectedOutcome) {
      throw new ConflictException('Post-Publication Review is closed');
    }
    const notice = await manager.getRepository(ModerationNoticeEntity).findOneBy({
      noticeType: expectedOutcome,
      reviewId: review.id,
    });
    if (notice === null) {
      throw new Error(`Post-Publication Review ${review.id} has inconsistent persisted state`);
    }
    const email = await manager.getRepository(EmailOutboxEntity).findOneBy({
      dedupeKey: `moderation_notice:${notice.id}`,
    });
    return this.closeView(review, notice, false, email !== null);
  }

  private async closePendingMetadataWork(
    manager: EntityManager,
    reviewId: string,
    patternId: string,
  ): Promise<
    { fromStatus: string; recordId: string; recordType: string; toStatus: string }[]
  > {
    const revisions = await manager.getRepository(CatalogMetadataRevisionEntity).find({
      lock: { mode: 'pessimistic_write' },
      order: { id: 'ASC' },
      where: {
        communityPatternId: patternId,
        status: In([...ACTIVE_REVISION_STATUSES]),
      },
    });
    if (revisions.length === 0) return [];

    const appealRevisionIds = revisions
      .filter((revision) => revision.status === 'appeal_pending')
      .map((revision) => revision.id);
    const appeals = appealRevisionIds.length === 0
      ? []
      : await manager.getRepository(CatalogMetadataAppealEntity).find({
          order: { id: 'ASC' },
          where: { revisionId: In(appealRevisionIds) },
        });

    const rows = [
      ...revisions.map((revision) => ({
        fromStatus: revision.status,
        recordId: revision.id,
        recordType: 'metadata_revision' as const,
        reviewId,
        toStatus: 'withdrawn',
      })),
      ...appeals.map((appeal) => ({
        fromStatus: 'open',
        recordId: appeal.id,
        recordType: 'metadata_appeal' as const,
        reviewId,
        toStatus: 'closed_without_publication',
      })),
    ];
    await manager.getRepository(PostPublicationReviewClosureEntity).save(rows);

    for (const revision of revisions) revision.status = 'withdrawn';
    await manager.getRepository(CatalogMetadataRevisionEntity).save(revisions);

    return rows.map(({ fromStatus, recordId, recordType, toStatus }) => ({
      fromStatus,
      recordId,
      recordType,
      toStatus,
    }));
  }

  private async createOwnerNotice(
    manager: EntityManager,
    input: {
      noticeType: ModerationNoticeType;
      pattern: { creatorProfileId: string | null; id: string; title: string };
      reason: string;
      reviewId: string;
    },
  ): Promise<{ emailQueued: boolean; notice: ModerationNoticeEntity }> {
    if (input.pattern.creatorProfileId === null) {
      throw new Error(`Community Pattern ${input.pattern.id} has no creator profile`);
    }
    const profile = await manager.getRepository(CreatorProfileEntity).findOneBy({
      id: input.pattern.creatorProfileId,
    });
    if (profile === null) {
      throw new Error(`Community Pattern ${input.pattern.id} has no creator profile`);
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

    const notices = manager.getRepository(ModerationNoticeEntity);
    const notice = await notices.save(
      notices.create({
        accountId: profile.accountId,
        communityPatternId: input.pattern.id,
        noticeType: input.noticeType,
        patternTitle: input.pattern.title,
        reason: input.reason,
        reviewId: input.reviewId,
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
            patternId: input.pattern.id,
            patternTitle: input.pattern.title,
            reason: input.reason,
          },
          template: 'moderation_notice',
          toEmail: emailIdentity.email,
        }),
      );
      emailQueued = true;
    }
    return { emailQueued, notice };
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
      this.dataSource.getRepository(ModerationNoticeEntity).findOne({
        order: { createdAt: 'DESC' },
        where: { reviewId: review.id },
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
      closeOutcome: review.closeOutcome,
      closeReason: review.closeReason,
      closedAt: review.closedAt?.toISOString() ?? null,
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

  private closeView(
    review: PostPublicationReviewEntity,
    notice: ModerationNoticeEntity,
    applied: boolean,
    emailQueued = true,
  ) {
    return {
      applied,
      closeOutcome: review.closeOutcome!,
      closedAt: review.closedAt!.toISOString(),
      emailQueued,
      moderationNoticeId: notice.id,
      patternId: review.communityPatternId,
      reason: review.closeReason,
      reviewId: review.id,
      status: 'closed' as const,
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
