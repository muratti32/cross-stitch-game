import { Injectable } from '@nestjs/common';

import { CATALOG_PRECHECK_JOB_TYPE } from '../jobs/jobs.constants';
import { ProcessingJobStatus } from '../jobs/entities';
import { ProcessingJobNotReadyError } from '../jobs/demo-job-consumer.service';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository';
import type { ProcessingJobQueueResult } from '../jobs/jobs.types';
import { CatalogPrecheckService } from './catalog-precheck.service';

@Injectable()
export class CatalogPrecheckJobConsumerService {
  constructor(
    private readonly jobs: ProcessingJobsRepository,
    private readonly precheck: CatalogPrecheckService,
  ) {}

  async processDelivery(processingJobId: string): Promise<ProcessingJobQueueResult> {
    const claim = await this.jobs.claimForWorker(processingJobId);
    if (claim.kind === 'missing') throw new Error(`Missing Catalog Precheck job ${processingJobId}`);
    if (claim.kind === 'retry') throw new ProcessingJobNotReadyError(processingJobId);
    if (claim.kind === 'terminal') return { outcome: 'terminal-replay', processingJobId };
    if (claim.job.type !== CATALOG_PRECHECK_JOB_TYPE) {
      await this.jobs.failFromRunning(processingJobId, 'Catalog Precheck job type is invalid');
      throw new Error('Catalog Precheck job type is invalid');
    }
    const submissionId = claim.job.payload.submissionId;
    if (typeof submissionId !== 'string') {
      await this.jobs.failFromRunning(processingJobId, 'Catalog Precheck payload is invalid');
      throw new Error('Catalog Precheck payload is invalid');
    }
    const submission = await this.precheck.run(submissionId);
    const completed = await this.jobs.completeFromRunning(processingJobId, {
      status: submission.status,
      submissionId,
    });
    if (!completed) {
      const current = await this.jobs.findById(processingJobId);
      if (current?.status !== ProcessingJobStatus.Completed) {
        throw new Error('Catalog Precheck job lost its running state');
      }
    }
    return {
      outcome: claim.kind === 'resume' ? 'resumed-and-completed' : 'completed',
      processingJobId,
    };
  }

  async failExhausted(processingJobId: string, reason: string): Promise<void> {
    const job = await this.jobs.findById(processingJobId);
    if (job?.status === ProcessingJobStatus.Running) {
      await this.jobs.failFromRunning(processingJobId, reason);
    }
    await this.precheck.markFailed(processingJobId);
  }
}
