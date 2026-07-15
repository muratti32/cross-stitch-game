import { mergeCellOperation, type MergeInput } from './progress-merge';

describe('mergeCellOperation', () => {
  it.each<readonly [string, MergeInput, 'completed' | 'incomplete', boolean]>([
    ['causally applies a stitch', { desiredState: 'completed', baseRevision: 7, current: { state: 'incomplete', revision: 7 } }, 'completed', true],
    ['causally applies an undo', { desiredState: 'incomplete', baseRevision: 8, current: { state: 'completed', revision: 7 } }, 'incomplete', true],
    ['causally applies when base revision is later', { desiredState: 'completed', baseRevision: 9, current: { state: 'incomplete', revision: 7 } }, 'completed', true],
    ['keeps completed for concurrent completed then incomplete', { desiredState: 'incomplete', baseRevision: 6, current: { state: 'completed', revision: 7 } }, 'completed', false],
    ['chooses completed for concurrent incomplete then completed', { desiredState: 'completed', baseRevision: 6, current: { state: 'incomplete', revision: 7 } }, 'completed', true],
    ['keeps incomplete for concurrent incompletes', { desiredState: 'incomplete', baseRevision: 6, current: { state: 'incomplete', revision: 7 } }, 'incomplete', false],
    ['makes a never-touched default cell completed', { desiredState: 'completed', baseRevision: 0, current: { state: 'incomplete', revision: 0 } }, 'completed', true],
    ['leaves a never-touched default cell incomplete', { desiredState: 'incomplete', baseRevision: 0, current: { state: 'incomplete', revision: 0 } }, 'incomplete', false],
  ])('%s', (_name, input, nextState, effective) => {
    expect(mergeCellOperation(input)).toEqual({ nextState, effective });
  });
});
