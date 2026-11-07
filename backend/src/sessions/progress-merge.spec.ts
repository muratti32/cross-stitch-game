import { mergeCellOperation, type MergeInput } from './progress-merge';

describe('mergeCellOperation', () => {
  it.each<readonly [string, MergeInput, 'completed' | 'incomplete', boolean]>([
    ['causally applies a stitch', { desiredState: 'completed', baseRevision: 7, deviceId: 'device-a', deviceSeq: 10, current: { state: 'incomplete', revision: 7 } }, 'completed', true],
    ['causally applies an undo', { desiredState: 'incomplete', baseRevision: 8, deviceId: 'device-a', deviceSeq: 10, current: { state: 'completed', revision: 7 } }, 'incomplete', true],
    ['causally applies when base revision is later', { desiredState: 'completed', baseRevision: 9, deviceId: 'device-a', deviceSeq: 10, current: { state: 'incomplete', revision: 7 } }, 'completed', true],
    ['keeps completed for concurrent completed then incomplete', { desiredState: 'incomplete', baseRevision: 6, deviceId: 'device-a', deviceSeq: 10, current: { state: 'completed', revision: 7, writerDeviceId: 'device-b', writerDeviceSeq: 4 } }, 'completed', false],
    ['chooses completed for concurrent incomplete then completed', { desiredState: 'completed', baseRevision: 6, deviceId: 'device-a', deviceSeq: 10, current: { state: 'incomplete', revision: 7, writerDeviceId: 'device-b', writerDeviceSeq: 4 } }, 'completed', true],
    ['keeps incomplete for concurrent incompletes', { desiredState: 'incomplete', baseRevision: 6, deviceId: 'device-a', deviceSeq: 10, current: { state: 'incomplete', revision: 7, writerDeviceId: 'device-b', writerDeviceSeq: 4 } }, 'incomplete', false],
    ['makes a never-touched default cell completed', { desiredState: 'completed', baseRevision: 0, deviceId: 'device-a', deviceSeq: 10, current: { state: 'incomplete', revision: 0 } }, 'completed', true],
    ['leaves a never-touched default cell incomplete', { desiredState: 'incomplete', baseRevision: 0, deviceId: 'device-a', deviceSeq: 10, current: { state: 'incomplete', revision: 0 } }, 'incomplete', false],
    ['applies an offline undo written by an earlier op of the same device', { desiredState: 'incomplete', baseRevision: 6, deviceId: 'device-a', deviceSeq: 11, current: { state: 'completed', revision: 7, writerDeviceId: 'device-a', writerDeviceSeq: 10 } }, 'incomplete', true],
    ['keeps completed when a later same-device op already wrote the cell', { desiredState: 'incomplete', baseRevision: 6, deviceId: 'device-a', deviceSeq: 10, current: { state: 'completed', revision: 7, writerDeviceId: 'device-a', writerDeviceSeq: 11 } }, 'completed', false],
    ['keeps completed when the cell writer is unknown', { desiredState: 'incomplete', baseRevision: 6, deviceId: 'device-a', deviceSeq: 11, current: { state: 'completed', revision: 7, writerDeviceId: null, writerDeviceSeq: null } }, 'completed', false],
    ['keeps completed when another device wrote the cell', { desiredState: 'incomplete', baseRevision: 6, deviceId: 'device-a', deviceSeq: 11, current: { state: 'completed', revision: 7, writerDeviceId: 'device-b', writerDeviceSeq: 10 } }, 'completed', false],
    ['keeps completed when another device op landed above the same base', { desiredState: 'incomplete', baseRevision: 6, deviceId: 'device-a', deviceSeq: 11, current: { state: 'completed', revision: 7, writerDeviceId: 'device-a', writerDeviceSeq: 10, foreignOpSinceBase: true } }, 'completed', false],
    ['applies the same-device undo when no foreign op landed above the base', { desiredState: 'incomplete', baseRevision: 6, deviceId: 'device-a', deviceSeq: 11, current: { state: 'completed', revision: 7, writerDeviceId: 'device-a', writerDeviceSeq: 10, foreignOpSinceBase: false } }, 'incomplete', true],
  ])('%s', (_name, input, nextState, effective) => {
    expect(mergeCellOperation(input)).toEqual({ nextState, effective });
  });
});
