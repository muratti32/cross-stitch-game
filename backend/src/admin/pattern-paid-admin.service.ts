import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  PatternEntity,
  type PatternUnlockPriceTier,
} from '../catalog/entities';
import { OfficialPatternDraftEntity } from './entities';
import { OperatorAuditLogService } from './operator-audit-log.service';
import { deriveUnlockPriceTier } from './pattern-price-tier';

export interface PatternPaidChangeResult {
  patternId: string;
  changed: boolean;
  beforeTier: PatternUnlockPriceTier;
  afterTier: PatternUnlockPriceTier;
  grandfatheredCount: number;
}

export type PatternPaidBulkErrorCode =
  | 'pattern_not_found'
  | 'pattern_not_eligible'
  | 'stitchable_cell_count_unknown'
  | 'internal_error';

export type PatternPaidBulkResult =
  | {
      patternId: string;
      outcome: 'changed' | 'unchanged';
      beforeTier: PatternUnlockPriceTier;
      afterTier: PatternUnlockPriceTier;
      grandfatheredCount: number;
    }
  | {
      patternId: string;
      outcome: 'failed';
      errorCode: PatternPaidBulkErrorCode;
    };

@Injectable()
export class PatternPaidAdminService {
  private readonly logger = new Logger(PatternPaidAdminService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditLog: OperatorAuditLogService,
  ) {}

  setPatternPaid(
    operatorAccountId: string,
    patternId: string,
    paid: boolean,
    requestId: string | null,
  ): Promise<PatternPaidChangeResult> {
    return this.dataSource.transaction((manager) =>
      this.setPatternPaidWithManager(
        manager,
        operatorAccountId,
        patternId,
        paid,
        requestId,
      ),
    );
  }

  async setPatternsPaid(
    operatorAccountId: string,
    patternIds: string[],
    paid: boolean,
    requestId: string | null,
  ): Promise<{ paid: boolean; results: PatternPaidBulkResult[] }> {
    const results: PatternPaidBulkResult[] = [];
    const canonicalPatternIds = patternIds.map((id) => id.toLowerCase()).sort();
    if (new Set(canonicalPatternIds).size !== canonicalPatternIds.length) {
      throw new BadRequestException(
        'Bulk paid change Pattern IDs must be unique',
      );
    }
    for (const patternId of canonicalPatternIds) {
      try {
        const result = await this.setPatternPaid(
          operatorAccountId,
          patternId,
          paid,
          requestId,
        );
        results.push({
          patternId,
          outcome: result.changed ? 'changed' : 'unchanged',
          beforeTier: result.beforeTier,
          afterTier: result.afterTier,
          grandfatheredCount: result.grandfatheredCount,
        });
      } catch (error: unknown) {
        const errorCode = this.classifyBulkError(error);
        if (errorCode === 'internal_error') {
          this.logger.error(
            `Failed to change paid state for Pattern ${patternId} (requestId=${requestId ?? 'none'})`,
            error instanceof Error ? error.stack : String(error),
          );
        }
        results.push({ patternId, outcome: 'failed', errorCode });
      }
    }
    return { paid, results };
  }

  private async setPatternPaidWithManager(
    manager: EntityManager,
    operatorAccountId: string,
    patternId: string,
    paid: boolean,
    requestId: string | null,
  ): Promise<PatternPaidChangeResult> {
    const pattern = await manager.getRepository(PatternEntity).findOne({
      lock: { mode: 'pessimistic_write' },
      where: { id: patternId },
    });
    if (pattern === null) {
      throw new NotFoundException({ code: 'pattern_not_found' });
    }
    if (
      pattern.creatorProfileId !== null ||
      pattern.visibility !== 'catalog' ||
      !['available', 'withdrawn', 'review_hold'].includes(pattern.status)
    ) {
      throw new ConflictException({ code: 'pattern_not_eligible' });
    }

    let stitchableCellCount = 0;
    if (paid) {
      const draft = await manager.getRepository(OfficialPatternDraftEntity).findOne({
        select: { stitchableCellCount: true },
        where: { publishedPatternId: pattern.id },
      });
      if (
        draft === null ||
        draft.stitchableCellCount === null ||
        draft.stitchableCellCount < 1
      ) {
        throw new ConflictException({
          code: 'stitchable_cell_count_unknown',
        });
      }
      stitchableCellCount = draft.stitchableCellCount;
    }

    const beforeTier = pattern.unlockPriceTier;
    const afterTier = deriveUnlockPriceTier(paid, stitchableCellCount);
    if (beforeTier === afterTier) {
      return {
        patternId,
        changed: false,
        beforeTier,
        afterTier,
        grandfatheredCount: 0,
      };
    }

    let grandfatheredCount = 0;
    if (beforeTier === null && afterTier !== null) {
      const inserted = await manager.query<readonly { principalId: string }[]>(
        `INSERT INTO economy.pattern_unlocks
           (principal_type, principal_id, pattern_id, source)
         SELECT DISTINCT
           s.principal_type, s.principal_id, s.pattern_id, 'grandfathered'
         FROM sessions.stitching_sessions s
         WHERE s.pattern_id = $1
           AND s.principal_type IN ('guest', 'account')
         ON CONFLICT ON CONSTRAINT "PK_pattern_unlocks" DO NOTHING
         RETURNING principal_id AS "principalId"`,
        [pattern.id],
      );
      grandfatheredCount = inserted.length;
    }

    pattern.unlockPriceTier = afterTier;
    await manager.getRepository(PatternEntity).save(pattern);
    await this.auditLog.record(manager, {
      action: 'pattern.paid_change',
      operatorAccountId,
      targetType: 'pattern',
      targetId: pattern.id,
      before: { unlockPriceTier: beforeTier },
      after: { unlockPriceTier: afterTier, paid, grandfatheredCount },
      outcome: 'success',
      requestId,
    });

    return {
      patternId,
      changed: true,
      beforeTier,
      afterTier,
      grandfatheredCount,
    };
  }

  private classifyBulkError(error: unknown): PatternPaidBulkErrorCode {
    if (error instanceof NotFoundException) return 'pattern_not_found';
    if (error instanceof ConflictException) {
      const response = error.getResponse();
      if (typeof response === 'object' && response !== null && 'code' in response) {
        const code = (response as { code?: unknown }).code;
        if (
          code === 'pattern_not_eligible' ||
          code === 'stitchable_cell_count_unknown'
        ) {
          return code;
        }
      }
    }
    return 'internal_error';
  }
}
