import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, Not } from 'typeorm';

import { OperatorAccountEntity } from '../admin/entities';
import { OperatorAuditLogService } from '../admin/operator-audit-log.service';
import { AuthIdentityEntity } from '../auth/entities';
import { EmailOutboxEntity } from '../auth/email-outbox.entity';
import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { CreatorProfileEntity } from '../creator-profile/entities';
import { previewContentType, safetyRemovalPreviewArchiveKey } from './catalog.utils';
import { CreateSafetyRemovalAppealDto } from './dto/create-safety-removal-appeal.dto';
import {
  ModerationNoticeEntity,
  ModerationNoticeType,
  PatternEntity,
  PostPublicationReviewEntity,
  SafetyRemovalAppealEntity,
  SafetyRemovalAppealStatus,
} from './entities';
import {
  OBJECT_STORAGE,
  ObjectStorage,
} from './storage/object-storage.interface';

@Injectable()
export class SafetyRemovalAppealService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly auditLog: OperatorAuditLogService,
  ) {}

  async create(principal: AuthPrincipal, patternId: string, dto: CreateSafetyRemovalAppealDto) {
    const accountId = this.requireAccount(principal);
    const pattern = await this.dataSource.getRepository(PatternEntity).findOneBy({ id: patternId });
    if (pattern === null || pattern.creatorProfileId === null) {
      throw new NotFoundException('Community Pattern not found');
    }
    const profile = await this.dataSource.getRepository(CreatorProfileEntity).findOneBy({
      accountId,
      id: pattern.creatorProfileId,
    });
    if (profile === null) throw new NotFoundException('Community Pattern not found');
    if (pattern.status !== 'removed') {
      throw new ConflictException('Only a safety-removed Community Pattern can be appealed');
    }
    const review = await this.dataSource.getRepository(PostPublicationReviewEntity).findOne({
      order: { closedAt: 'DESC' },
      where: { closeOutcome: 'safety_removal', communityPatternId: patternId, status: 'closed' },
    });
    if (review === null || review.closeOperatorAccountId === null) {
      throw new ConflictException('No Safety Removal decision found for this Community Pattern');
    }

    return this.dataSource.transaction(async (manager) => {
      const patterns = manager.getRepository(PatternEntity);
      const lockedPattern = await patterns.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: patternId },
      });
      if (lockedPattern === null || lockedPattern.status !== 'removed') {
        throw new ConflictException('Only a safety-removed Community Pattern can be appealed');
      }
      const appeals = manager.getRepository(SafetyRemovalAppealEntity);
      const existing = await appeals.findOneBy({ reviewId: review.id });
      if (existing !== null) {
        throw new ConflictException('This Safety Removal decision has already used its appeal');
      }
      const appeal = await appeals.save(
        appeals.create({
          accountId,
          communityPatternId: patternId,
          excludedOperatorAccountId: review.closeOperatorAccountId!,
          note: dto.note?.trim() || null,
          reviewId: review.id,
        }),
      );
      return this.ownerView(appeal);
    });
  }

  async getMine(principal: AuthPrincipal, patternId: string) {
    const accountId = this.requireAccount(principal);
    const appeal = await this.dataSource.getRepository(SafetyRemovalAppealEntity).findOneBy({
      accountId,
      communityPatternId: patternId,
    });
    return appeal === null ? null : this.ownerView(appeal);
  }

  async listForReview(status?: string) {
    const allowed = ['open', 'accepted', 'rejected'];
    const statuses = status === undefined ? ['open'] : allowed.includes(status) ? [status] : [];
    if (statuses.length === 0) throw new BadRequestException('Unknown Safety Removal Appeal status');
    const appeals = await this.dataSource.getRepository(SafetyRemovalAppealEntity).find({
      order: { createdAt: 'ASC' },
      where: { status: In(statuses) },
    });
    if (appeals.length === 0) return [];
    const patterns = await this.dataSource.getRepository(PatternEntity).findBy({
      id: In(appeals.map((appeal) => appeal.communityPatternId)),
    });
    const patternById = new Map(patterns.map((pattern) => [pattern.id, pattern]));
    return appeals.map((appeal) => {
      const pattern = patternById.get(appeal.communityPatternId);
      if (pattern === undefined) {
        throw new Error(`Safety Removal Appeal ${appeal.id} has no Pattern`);
      }
      return this.reviewListView(appeal, pattern.title);
    });
  }

  async getForReview(id: string) {
    const appeal = await this.dataSource.getRepository(SafetyRemovalAppealEntity).findOneBy({ id });
    if (appeal === null) throw new NotFoundException('Safety Removal Appeal not found');
    const [pattern, review] = await Promise.all([
      this.dataSource.getRepository(PatternEntity).findOne({
        relations: ['tags'],
        where: { id: appeal.communityPatternId },
      }),
      this.dataSource.getRepository(PostPublicationReviewEntity).findOneBy({ id: appeal.reviewId }),
    ]);
    if (pattern === null) throw new Error(`Safety Removal Appeal ${appeal.id} has no Pattern`);
    return {
      ...this.reviewListView(appeal, pattern.title),
      decisionOperatorAccountId: appeal.decisionOperatorAccountId,
      decisionReason: appeal.decisionReason,
      pattern: {
        categoryCode: pattern.categoryCode,
        description: pattern.description,
        id: pattern.id,
        previewUrl: this.storage.publicUrl(pattern.previewObjectKey),
        status: pattern.status,
        tagCodes: pattern.tags.map((tag) => tag.code),
        title: pattern.title,
      },
      reviewCloseReason: review?.closeReason ?? null,
      sameModeratorFallback: appeal.sameModeratorFallback,
    };
  }

  async accept(
    operatorAccountId: string,
    id: string,
    rawReason: string,
    requestId: string | null,
  ) {
    const reason = normalizeReason(rawReason);
    if (reason.length === 0 || reason.length > 2000) {
      throw new ConflictException('Safety Removal Appeal acceptance reason is required');
    }

    return this.dataSource.transaction(async (manager) => {
      const appeals = manager.getRepository(SafetyRemovalAppealEntity);
      const appeal = await appeals.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id },
      });
      if (appeal === null) throw new NotFoundException('Safety Removal Appeal not found');
      if (appeal.status !== 'open') {
        return this.idempotentDecisionView(manager, appeal, 'accepted');
      }

      const sameModeratorFallback = await this.resolveModeratorAssignment(
        manager,
        operatorAccountId,
        appeal.excludedOperatorAccountId,
      );

      const patterns = manager.getRepository(PatternEntity);
      const pattern = await patterns.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: appeal.communityPatternId },
      });
      if (pattern === null || pattern.status !== 'removed') {
        throw new ConflictException('Community Pattern is not under Safety Removal');
      }

      const before = { patternStatus: pattern.status };
      pattern.status = 'available';
      await patterns.save(pattern);

      const archiveKey = safetyRemovalPreviewArchiveKey(pattern.id, pattern.previewObjectKey);
      const archivedPreview = await this.storage.get(archiveKey);
      let previewRestored = false;
      if (archivedPreview !== null) {
        await this.storage.put(
          pattern.previewObjectKey,
          archivedPreview,
          previewContentType(pattern.previewObjectKey),
        );
        await this.storage.delete(archiveKey);
        previewRestored = true;
      }

      appeal.status = 'accepted';
      appeal.decidedAt = new Date();
      appeal.decisionOperatorAccountId = operatorAccountId;
      appeal.decisionReason = reason;
      appeal.sameModeratorFallback = sameModeratorFallback;
      await appeals.save(appeal);

      const { notice, emailQueued } = await this.createOwnerNotice(manager, {
        accountId: appeal.accountId,
        noticeType: 'safety_removal_appeal_accepted',
        pattern,
        reason,
        reviewId: appeal.reviewId,
      });

      await this.auditLog.record(manager, {
        action: 'safety_removal_appeal.accept',
        after: {
          emailQueued,
          moderationNoticeId: notice.id,
          patternStatus: pattern.status,
          previewRestored,
          sameModeratorFallback,
        },
        before,
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: appeal.id,
        targetType: 'safety_removal_appeal',
      });

      return this.decisionView(appeal, notice, true, emailQueued);
    });
  }

  async reject(
    operatorAccountId: string,
    id: string,
    rawReason: string,
    requestId: string | null,
  ) {
    const reason = normalizeReason(rawReason);
    if (reason.length === 0 || reason.length > 2000) {
      throw new ConflictException('Safety Removal Appeal rejection reason is required');
    }

    return this.dataSource.transaction(async (manager) => {
      const appeals = manager.getRepository(SafetyRemovalAppealEntity);
      const appeal = await appeals.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id },
      });
      if (appeal === null) throw new NotFoundException('Safety Removal Appeal not found');
      if (appeal.status !== 'open') {
        return this.idempotentDecisionView(manager, appeal, 'rejected');
      }

      const sameModeratorFallback = await this.resolveModeratorAssignment(
        manager,
        operatorAccountId,
        appeal.excludedOperatorAccountId,
      );

      const pattern = await manager.getRepository(PatternEntity).findOneBy({
        id: appeal.communityPatternId,
      });
      if (pattern === null) throw new Error(`Safety Removal Appeal ${appeal.id} has no Pattern`);

      appeal.status = 'rejected';
      appeal.decidedAt = new Date();
      appeal.decisionOperatorAccountId = operatorAccountId;
      appeal.decisionReason = reason;
      appeal.sameModeratorFallback = sameModeratorFallback;
      await appeals.save(appeal);

      const { notice, emailQueued } = await this.createOwnerNotice(manager, {
        accountId: appeal.accountId,
        noticeType: 'safety_removal_appeal_rejected',
        pattern,
        reason,
        reviewId: appeal.reviewId,
      });

      await this.auditLog.record(manager, {
        action: 'safety_removal_appeal.reject',
        after: { emailQueued, moderationNoticeId: notice.id, sameModeratorFallback },
        before: { status: 'open' },
        operatorAccountId,
        outcome: 'success',
        requestId,
        targetId: appeal.id,
        targetType: 'safety_removal_appeal',
      });

      return this.decisionView(appeal, notice, true, emailQueued);
    });
  }

  // AC: "assigned to a different moderator when another eligible moderator
  // exists". The excluded moderator may still resolve their own decision
  // when they are the only eligible operator account; that fallback is
  // reported back to the caller so it lands in the audit log entry.
  private async resolveModeratorAssignment(
    manager: EntityManager,
    operatorAccountId: string,
    excludedOperatorAccountId: string,
  ): Promise<boolean> {
    if (operatorAccountId !== excludedOperatorAccountId) return false;
    const otherEligible = await manager.getRepository(OperatorAccountEntity).count({
      where: { disabled: false, id: Not(excludedOperatorAccountId) },
    });
    if (otherEligible > 0) {
      throw new ConflictException('Safety Removal Appeal must be assigned to a different moderator');
    }
    return true;
  }

  private async idempotentDecisionView(
    manager: EntityManager,
    appeal: SafetyRemovalAppealEntity,
    expectedStatus: SafetyRemovalAppealStatus,
  ) {
    if (appeal.status !== expectedStatus) {
      throw new ConflictException('Safety Removal Appeal is already closed');
    }
    const noticeType: ModerationNoticeType =
      expectedStatus === 'accepted' ? 'safety_removal_appeal_accepted' : 'safety_removal_appeal_rejected';
    const notice = await manager.getRepository(ModerationNoticeEntity).findOneBy({
      noticeType,
      reviewId: appeal.reviewId,
    });
    if (notice === null) {
      throw new Error(`Safety Removal Appeal ${appeal.id} has inconsistent persisted state`);
    }
    const email = await manager.getRepository(EmailOutboxEntity).findOneBy({
      dedupeKey: `moderation_notice:${notice.id}`,
    });
    return this.decisionView(appeal, notice, false, email !== null);
  }

  private async createOwnerNotice(
    manager: EntityManager,
    input: {
      accountId: string;
      noticeType: ModerationNoticeType;
      pattern: { id: string; title: string };
      reason: string;
      reviewId: string;
    },
  ): Promise<{ emailQueued: boolean; notice: ModerationNoticeEntity }> {
    const emailIdentity = await manager
      .getRepository(AuthIdentityEntity)
      .createQueryBuilder('identity')
      .where('identity.accountId = :accountId', { accountId: input.accountId })
      .andWhere('identity.email IS NOT NULL')
      .orderBy("CASE WHEN identity.provider = 'email' THEN 0 ELSE 1 END", 'ASC')
      .addOrderBy('identity.createdAt', 'ASC')
      .addOrderBy('identity.id', 'ASC')
      .getOne();

    const notices = manager.getRepository(ModerationNoticeEntity);
    const notice = await notices.save(
      notices.create({
        accountId: input.accountId,
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

  private ownerView(appeal: SafetyRemovalAppealEntity) {
    return {
      createdAt: appeal.createdAt.toISOString(),
      id: appeal.id,
      note: appeal.note,
      patternId: appeal.communityPatternId,
      reviewId: appeal.reviewId,
      status: appeal.status,
    };
  }

  private reviewListView(appeal: SafetyRemovalAppealEntity, patternTitle: string) {
    return {
      createdAt: appeal.createdAt.toISOString(),
      excludedOperatorAccountId: appeal.excludedOperatorAccountId,
      id: appeal.id,
      note: appeal.note,
      patternId: appeal.communityPatternId,
      patternTitle,
      reviewId: appeal.reviewId,
      status: appeal.status,
    };
  }

  private decisionView(
    appeal: SafetyRemovalAppealEntity,
    notice: ModerationNoticeEntity,
    applied: boolean,
    emailQueued: boolean,
  ) {
    return {
      applied,
      decisionReason: appeal.decisionReason,
      emailQueued,
      id: appeal.id,
      moderationNoticeId: notice.id,
      patternId: appeal.communityPatternId,
      sameModeratorFallback: appeal.sameModeratorFallback,
      status: appeal.status,
    };
  }

  private requireAccount(principal: AuthPrincipal): string {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('Registered Account required');
    }
    return principal.id;
  }
}

function normalizeReason(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}
