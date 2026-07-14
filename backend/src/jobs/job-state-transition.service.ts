import { Injectable } from '@nestjs/common';

import { ProcessingJobStatus } from './entities';

const ALLOWED_TRANSITIONS: Readonly<
  Record<ProcessingJobStatus, readonly ProcessingJobStatus[]>
> = {
  [ProcessingJobStatus.Pending]: [ProcessingJobStatus.Dispatched],
  [ProcessingJobStatus.Dispatched]: [ProcessingJobStatus.Running],
  [ProcessingJobStatus.Running]: [
    ProcessingJobStatus.Completed,
    ProcessingJobStatus.Failed,
  ],
  [ProcessingJobStatus.Completed]: [],
  [ProcessingJobStatus.Failed]: [],
};

export class InvalidJobStateTransitionError extends Error {
  constructor(from: ProcessingJobStatus, to: ProcessingJobStatus) {
    super(`Invalid Processing Job transition: ${from} -> ${to}`);
    this.name = InvalidJobStateTransitionError.name;
  }
}

@Injectable()
export class JobStateTransitionService {
  canTransition(
    from: ProcessingJobStatus,
    to: ProcessingJobStatus,
  ): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
  }

  assertTransition(
    from: ProcessingJobStatus,
    to: ProcessingJobStatus,
  ): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidJobStateTransitionError(from, to);
    }
  }

  isTerminal(status: ProcessingJobStatus): boolean {
    return (
      status === ProcessingJobStatus.Completed ||
      status === ProcessingJobStatus.Failed
    );
  }
}

