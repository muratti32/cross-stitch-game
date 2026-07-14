import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import {
  DEMO_JOB_EVENT_NAME,
  DEMO_JOB_TYPE,
  DEMO_JOBS_QUEUE_NAME,
} from './jobs.constants';
import { JobOutboxEntity, ProcessingJobEntity, ProcessingJobStatus } from './entities';
import { JobStateTransitionService } from './job-state-transition.service';
import { DemoJobPayload, JsonObject } from './jobs.types';

export interface PendingJobAndOutbox {
  job: ProcessingJobEntity;
  outbox: JobOutboxEntity;
}

export interface JobTransitionPatch {
  errorMessage?: string | null;
  result?: JsonObject | null;
}

export type ProcessingJobClaim =
  | { job: ProcessingJobEntity; kind: 'claimed' }
  | { job: ProcessingJobEntity; kind: 'resume' }
  | { job: ProcessingJobEntity; kind: 'terminal' }
  | { kind: 'missing' }
  | { kind: 'retry' };

@Injectable()
export class ProcessingJobsRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly stateTransitions: JobStateTransitionService,
  ) {}

  async createPendingWithOutbox(
    manager: EntityManager,
    payload: DemoJobPayload,
  ): Promise<PendingJobAndOutbox> {
    const jobRepository = manager.getRepository(ProcessingJobEntity);
    const outboxRepository = manager.getRepository(JobOutboxEntity);

    const job = await jobRepository.save(
      jobRepository.create({
        errorMessage: null,
        payload,
        result: null,
        status: ProcessingJobStatus.Pending,
        type: DEMO_JOB_TYPE,
      }),
    );

    const outboxPayload: JsonObject = { processingJobId: job.id };
    const outbox = await outboxRepository.save(
      outboxRepository.create({
        dispatchedAt: null,
        eventName: DEMO_JOB_EVENT_NAME,
        lastReconciledAt: null,
        payload: outboxPayload,
        processingJobId: job.id,
        queueName: DEMO_JOBS_QUEUE_NAME,
      }),
    );

    return { job, outbox };
  }

  findById(
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<ProcessingJobEntity | null> {
    return manager.getRepository(ProcessingJobEntity).findOneBy({ id });
  }

  async transitionStatus(
    id: string,
    from: ProcessingJobStatus | readonly ProcessingJobStatus[],
    to: ProcessingJobStatus,
    patch: JobTransitionPatch = {},
    manager: EntityManager = this.dataSource.manager,
  ): Promise<boolean> {
    const expectedStatuses: readonly ProcessingJobStatus[] =
      typeof from === 'string' ? [from] : from;
    for (const expectedStatus of expectedStatuses) {
      this.stateTransitions.assertTransition(expectedStatus, to);
    }

    const parameters: unknown[] = [id, expectedStatuses, to];
    const assignments = ['status = $3', 'updated_at = CURRENT_TIMESTAMP'];
    if (Object.prototype.hasOwnProperty.call(patch, 'result')) {
      parameters.push(
        patch.result === null ? null : JSON.stringify(patch.result),
      );
      assignments.push(`result = $${parameters.length}::jsonb`);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'errorMessage')) {
      parameters.push(patch.errorMessage ?? null);
      assignments.push(`error_message = $${parameters.length}`);
    }

    const updatedRows = await manager.query<readonly { id: string }[]>(
      `UPDATE jobs.processing_jobs
       SET ${assignments.join(', ')}
       WHERE id = $1 AND status = ANY($2::varchar[])
       RETURNING id`,
      parameters,
    );
    return updatedRows.length === 1;
  }

  markDispatched(
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<boolean> {
    return this.transitionStatus(
      id,
      ProcessingJobStatus.Pending,
      ProcessingJobStatus.Dispatched,
      {},
      manager,
    );
  }

  async claimForWorker(id: string): Promise<ProcessingJobClaim> {
    const claimed = await this.transitionStatus(
      id,
      ProcessingJobStatus.Dispatched,
      ProcessingJobStatus.Running,
    );

    const job = await this.findById(id);
    if (job === null) {
      return { kind: 'missing' };
    }
    if (claimed) {
      return { job, kind: 'claimed' };
    }

    switch (job.status) {
      case ProcessingJobStatus.Pending:
        return { kind: 'retry' };
      case ProcessingJobStatus.Running:
        return { job, kind: 'resume' };
      case ProcessingJobStatus.Completed:
      case ProcessingJobStatus.Failed:
        return { job, kind: 'terminal' };
      case ProcessingJobStatus.Dispatched:
        return { kind: 'retry' };
    }
  }

  completeFromRunning(id: string, result: JsonObject): Promise<boolean> {
    return this.transitionStatus(
      id,
      ProcessingJobStatus.Running,
      ProcessingJobStatus.Completed,
      { errorMessage: null, result },
    );
  }

  failFromRunning(id: string, errorMessage: string): Promise<boolean> {
    return this.transitionStatus(
      id,
      ProcessingJobStatus.Running,
      ProcessingJobStatus.Failed,
      { errorMessage, result: null },
    );
  }
}
