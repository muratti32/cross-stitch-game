export type CellStateValue = 'completed' | 'incomplete';

export interface CellSnapshot {
  state: CellStateValue;
  revision: number;
}

export interface MergeInput {
  desiredState: CellStateValue;
  baseRevision: number;
  current: CellSnapshot;
}

export interface MergeDecision {
  nextState: CellStateValue;
  effective: boolean;
}

export function mergeCellOperation(input: MergeInput): MergeDecision {
  const nextState = input.baseRevision >= input.current.revision
    ? input.desiredState
    : input.current.state === 'completed' || input.desiredState === 'completed'
      ? 'completed'
      : 'incomplete';

  return {
    nextState,
    effective: nextState !== input.current.state,
  };
}
