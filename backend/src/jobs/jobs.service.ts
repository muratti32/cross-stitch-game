import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ProcessingJobsRepository } from './processing-jobs.repository';
import { DEMO_JOB_TYPE } from './jobs.constants';
import {
  CreatedDemoJob,
  DemoJobPayload,
  DemoJobView,
} from './jobs.types';

@Injectable()
export class JobsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly processingJobs: ProcessingJobsRepository,
  ) {}

  async createDemoJob(message: string): Promise<CreatedDemoJob> {
    const payload: DemoJobPayload = { message };
    const created = await this.dataSource.transaction((manager) =>
      this.processingJobs.createPendingWithOutbox(manager, payload),
    );
    return { id: created.job.id };
  }

  async getDemoJob(id: string): Promise<DemoJobView | null> {
    const job = await this.processingJobs.findById(id);
    if (job === null || job.type !== DEMO_JOB_TYPE) {
      return null;
    }

    return {
      createdAt: job.createdAt.toISOString(),
      errorMessage: job.errorMessage,
      id: job.id,
      payload: job.payload,
      result: job.result,
      status: job.status,
      type: job.type,
      updatedAt: job.updatedAt.toISOString(),
    };
  }
}
