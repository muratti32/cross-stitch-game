export type CellStateValue = 'completed' | 'incomplete';

export interface CellSnapshot {
  state: CellStateValue;
  revision: number;
  /** Device that wrote the current cell revision, when the op log still knows it. */
  writerDeviceId?: string | null;
  writerDeviceSeq?: number | null;
}

export interface MergeInput {
  desiredState: CellStateValue;
  baseRevision: number;
  deviceId: string;
  deviceSeq: number;
  current: CellSnapshot;
}

export interface MergeDecision {
  nextState: CellStateValue;
  effective: boolean;
}

export function mergeCellOperation(input: MergeInput): MergeDecision {
  // A device's ops are totally ordered, so an op it created after the one that
  // wrote the cell's current revision observed that write even when both carry
  // the same stale base revision (an offline stitch followed by its undo).
  const writerIsSameDevice = input.current.writerDeviceId === input.deviceId
    && input.current.writerDeviceSeq !== null
    && input.current.writerDeviceSeq !== undefined
    && input.current.writerDeviceSeq < input.deviceSeq;
  const causal = input.baseRevision >= input.current.revision || writerIsSameDevice;

  const nextState = causal
    ? input.desiredState
    : input.current.state === 'completed' || input.desiredState === 'completed'
      ? 'completed'
      : 'incomplete';

  return {
    nextState,
    effective: nextState !== input.current.state,
  };
}
