import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OperationalAlertRunEntity } from '../observability';

export interface OperationalAlertSignalReport {
  value: number;
  threshold: number;
  breached: boolean;
}

export interface OperationalAlertsAdminReport {
  run: {
    evaluatedAt: Date;
    queueDepth: OperationalAlertSignalReport;
    webhookFailures: OperationalAlertSignalReport;
    stuckJobs: OperationalAlertSignalReport;
    promotionNeedsAttention: OperationalAlertSignalReport;
  } | null;
}

@Injectable()
export class OperationalAlertsAdminService {
  constructor(
    @InjectRepository(OperationalAlertRunEntity)
    private readonly runs: Repository<OperationalAlertRunEntity>,
  ) {}

  async latest(): Promise<OperationalAlertsAdminReport> {
    // findOne requires selection conditions; take: 1 gets the latest run without a where clause.
    const [run = null] = await this.runs.find({ order: { evaluatedAt: 'DESC' }, take: 1 });
    if (run === null) {
      return { run: null };
    }
    return {
      run: {
        evaluatedAt: run.evaluatedAt,
        promotionNeedsAttention: {
          breached: run.promotionNeedsAttentionBreached,
          threshold: run.promotionNeedsAttentionThreshold,
          value: run.promotionNeedsAttentionValue,
        },
        queueDepth: {
          breached: run.queueDepthBreached,
          threshold: run.queueDepthThreshold,
          value: run.queueDepthValue,
        },
        stuckJobs: {
          breached: run.stuckJobsBreached,
          threshold: run.stuckJobsThreshold,
          value: run.stuckJobsValue,
        },
        webhookFailures: {
          breached: run.webhookFailuresBreached,
          threshold: run.webhookFailuresThreshold,
          value: run.webhookFailuresValue,
        },
      },
    };
  }
}
