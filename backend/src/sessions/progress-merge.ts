export type CellStateValue = 'completed' | 'incomplete';

export interface CellSnapshot {
  state: CellStateValue;
  revision: number;
  /**
   * Device that wrote the current cell revision, when the op log has exactly one
   * effective op for it. Promotion moves operations between sessions and can
   * make that revision ambiguous, in which case the writer is unknown.
   */
  writerDeviceId?: string | null;
  writerDeviceSeq?: number | null;
  /** Whether another device wrote an op for this cell after the incoming base. */
  foreignOpSinceBase?: boolean;
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
  // the same stale base revision (an offline stitch followed by its undo). That
  // only holds while no other device's op landed above the same base: otherwise
  // this op never saw that concurrent write and completed-wins must decide.
  const writerIsSameDevice = input.current.writerDeviceId === input.deviceId
    && input.current.writerDeviceSeq !== null
    && input.current.writerDeviceSeq !== undefined
    && input.current.writerDeviceSeq < input.deviceSeq
    && input.current.foreignOpSinceBase !== true;
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
