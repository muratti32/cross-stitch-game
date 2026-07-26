import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  ReconciliationFindingEntity,
  ReconciliationRunEntity,
} from '../reconciliation';

export interface ReconciliationAdminReport {
  run: {
    aiCreditReservationStuckCount: number;
    commerceDeliveryWithoutLedgerCount: number;
    commerceLedgerWithoutDeliveryCount: number;
    commerceWindowStart: Date;
    ranAt: Date;
    storageOrphanObjectCount: number;
    storageRegistryMissingObjectCount: number;
  } | null;
  findings: readonly {
    detail: string | null;
    findingClass: ReconciliationFindingEntity['findingClass'];
    identifier: string;
    relatedIdentifier: string | null;
  }[];
}

@Injectable()
export class ReconciliationAdminService {
  constructor(
    @InjectRepository(ReconciliationRunEntity)
    private readonly runs: Repository<ReconciliationRunEntity>,
    @InjectRepository(ReconciliationFindingEntity)
    private readonly findings: Repository<ReconciliationFindingEntity>,
  ) {}

  async latest(): Promise<ReconciliationAdminReport> {
    // findOne requires selection conditions; take: 1 gets the latest run without a where clause.
    const [run = null] = await this.runs.find({ order: { ranAt: 'DESC' }, take: 1 });
    if (run === null) {
      return { findings: [], run: null };
    }
    const findings = await this.findings.find({
      order: { findingClass: 'ASC', identifier: 'ASC' },
      where: { runId: run.id },
    });
    return {
      findings: findings.map((finding) => ({
        detail: finding.detail,
        findingClass: finding.findingClass,
        identifier: finding.identifier,
        relatedIdentifier: finding.relatedIdentifier,
      })),
      run: {
        aiCreditReservationStuckCount: run.aiCreditReservationStuckCount,
        commerceDeliveryWithoutLedgerCount: run.commerceDeliveryWithoutLedgerCount,
        commerceLedgerWithoutDeliveryCount: run.commerceLedgerWithoutDeliveryCount,
        commerceWindowStart: run.commerceWindowStart,
        ranAt: run.ranAt,
        storageOrphanObjectCount: run.storageOrphanObjectCount,
        storageRegistryMissingObjectCount: run.storageRegistryMissingObjectCount,
      },
    };
  }
}
