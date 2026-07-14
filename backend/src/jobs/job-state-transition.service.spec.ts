import {
  InvalidJobStateTransitionError,
  JobStateTransitionService,
} from './job-state-transition.service';
import { ProcessingJobStatus } from './entities';

describe('JobStateTransitionService', () => {
  const service = new JobStateTransitionService();

  it.each([
    [ProcessingJobStatus.Pending, ProcessingJobStatus.Dispatched],
    [ProcessingJobStatus.Dispatched, ProcessingJobStatus.Running],
    [ProcessingJobStatus.Running, ProcessingJobStatus.Completed],
    [ProcessingJobStatus.Running, ProcessingJobStatus.Failed],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(service.canTransition(from, to)).toBe(true);
    expect(() => service.assertTransition(from, to)).not.toThrow();
  });

  it.each([
    [ProcessingJobStatus.Pending, ProcessingJobStatus.Running],
    [ProcessingJobStatus.Dispatched, ProcessingJobStatus.Completed],
    [ProcessingJobStatus.Completed, ProcessingJobStatus.Running],
    [ProcessingJobStatus.Failed, ProcessingJobStatus.Running],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(service.canTransition(from, to)).toBe(false);
    expect(() => service.assertTransition(from, to)).toThrow(
      new InvalidJobStateTransitionError(from, to),
    );
  });

  it.each([
    [ProcessingJobStatus.Pending, false],
    [ProcessingJobStatus.Dispatched, false],
    [ProcessingJobStatus.Running, false],
    [ProcessingJobStatus.Completed, true],
    [ProcessingJobStatus.Failed, true],
  ] as const)('reports whether %s is terminal', (status, isTerminal) => {
    expect(service.isTerminal(status)).toBe(isTerminal);
  });
});
