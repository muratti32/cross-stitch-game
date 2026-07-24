import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { CreatorProfileEntity } from '../creator-profile/entities';
import {
  CatalogMetadataAppealEntity,
  CatalogMetadataRevisionEntity,
  CatalogWithdrawalClosureEntity,
  CatalogWithdrawalEntity,
  PatternEntity,
} from './entities';

const ACTIVE_REVISION_STATUSES = ['pending', 'appeal_pending'] as const;

@Injectable()
export class CatalogWithdrawalService {
  constructor(private readonly dataSource: DataSource) {}

  async withdraw(principal: AuthPrincipal, patternId: string) {
    const accountId = this.requireAccount(principal);

    return this.dataSource.transaction(async (manager) => {
      const withdrawals = manager.getRepository(CatalogWithdrawalEntity);
      const existing = await withdrawals.findOneBy({ communityPatternId: patternId });
      if (existing !== null) {
        if (existing.accountId !== accountId) {
          throw new NotFoundException('Community Pattern not found');
        }
        return this.response(manager, existing, false);
      }

      const patterns = manager.getRepository(PatternEntity);
      const pattern = await patterns.findOne({
        lock: { mode: 'pessimistic_write' },
        where: { id: patternId, visibility: 'catalog' },
      });
      if (pattern === null || pattern.creatorProfileId === null) {
        throw new NotFoundException('Community Pattern not found');
      }

      // A concurrent retry may have waited on the Pattern lock while the first
      // transaction committed its immutable withdrawal record.
      const concurrentExisting = await withdrawals.findOneBy({
        communityPatternId: patternId,
      });
      if (concurrentExisting !== null) {
        if (concurrentExisting.accountId !== accountId) {
          throw new NotFoundException('Community Pattern not found');
        }
        return this.response(manager, concurrentExisting, false);
      }

      const profile = await manager.getRepository(CreatorProfileEntity).findOneBy({
        accountId,
        id: pattern.creatorProfileId,
      });
      if (profile === null) {
        throw new NotFoundException('Community Pattern not found');
      }
      if (pattern.status !== 'available') {
        throw new ConflictException('Community Pattern is not available for withdrawal');
      }

      const revisions = await manager.getRepository(CatalogMetadataRevisionEntity).find({
        lock: { mode: 'pessimistic_write' },
        order: { id: 'ASC' },
        where: {
          communityPatternId: patternId,
          status: In([...ACTIVE_REVISION_STATUSES]),
        },
      });
      const appealRevisionIds = revisions
        .filter((revision) => revision.status === 'appeal_pending')
        .map((revision) => revision.id);
      const appeals = appealRevisionIds.length === 0
        ? []
        : await manager.getRepository(CatalogMetadataAppealEntity).find({
            order: { id: 'ASC' },
            where: { revisionId: In(appealRevisionIds) },
          });

      const withdrawal = await withdrawals.save({
        accountId,
        communityPatternId: patternId,
        creatorProfileId: profile.id,
        previousStatus: 'available',
      });

      const closures = manager.getRepository(CatalogWithdrawalClosureEntity);
      if (revisions.length > 0) {
        await closures.save(
          revisions.map((revision) => ({
            fromStatus: revision.status,
            recordId: revision.id,
            recordType: 'metadata_revision' as const,
            toStatus: 'withdrawn',
            withdrawalId: withdrawal.id,
          })),
        );
      }
      if (appeals.length > 0) {
        await closures.save(
          appeals.map((appeal) => ({
            fromStatus: 'open',
            recordId: appeal.id,
            recordType: 'metadata_appeal' as const,
            toStatus: 'closed_without_publication',
            withdrawalId: withdrawal.id,
          })),
        );
      }

      for (const revision of revisions) revision.status = 'withdrawn';
      if (revisions.length > 0) {
        await manager.getRepository(CatalogMetadataRevisionEntity).save(revisions);
      }
      pattern.status = 'withdrawn';
      await patterns.save(pattern);

      return this.response(manager, withdrawal, true);
    });
  }

  private requireAccount(principal: AuthPrincipal): string {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('Registered Account required');
    }
    return principal.id;
  }

  private async response(
    manager: import('typeorm').EntityManager,
    withdrawal: CatalogWithdrawalEntity,
    created: boolean,
  ) {
    const closures = await manager.getRepository(CatalogWithdrawalClosureEntity).find({
      order: { createdAt: 'ASC', id: 'ASC' },
      where: { withdrawalId: withdrawal.id },
    });
    return {
      created,
      withdrawal: {
        closedRecords: closures.map((closure) => ({
          fromStatus: closure.fromStatus,
          recordId: closure.recordId,
          recordType: closure.recordType,
          toStatus: closure.toStatus,
        })),
        createdAt: withdrawal.createdAt.toISOString(),
        id: withdrawal.id,
        patternId: withdrawal.communityPatternId,
        status: 'withdrawn' as const,
      },
    };
  }
}
