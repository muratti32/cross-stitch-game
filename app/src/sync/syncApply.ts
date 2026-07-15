/**
 * Pure convergence logic for Progress Sync. No React Native / Expo imports so it
 * is fully unit-testable. The server is authoritative: it returns, for every
 * operation newer than the client's watermark (the client's own included), the
 * merge-resolved cell state in server_revision order. Replaying those resolved
 * states onto the client's bitmap reproduces the authoritative per-cell state —
 * this also corrects the client's optimistic op when the server resolved a
 * genuinely-concurrent conflict differently (completed-wins).
 */

export type CellState = 'completed' | 'incomplete';

export interface ResolvedOperation {
  cellIndex: number;
  resolvedState: CellState;
  serverRevision: number;
}

export interface ApplyResult {
  /** The bitmap after applying every resolved op (mutated in place and returned). */
  completed: Uint8Array;
  /** The highest server_revision applied, or the passed-in watermark if none. */
  serverRevision: number;
  /**
   * Cell indexes whose value changed as a result of applying the server's
   * resolved states. Used to surface a single conflict notice when the server
   * overrode a local optimistic op.
   */
  changedCells: number[];
}

/**
 * Applies server-resolved operations onto `completed` in server_revision order.
 * Out-of-range cell indexes are ignored. Returns the new watermark and the set
 * of cells the server changed relative to the client's pre-apply bitmap.
 */
export function applyResolvedOperations(
  completed: Uint8Array,
  operations: readonly ResolvedOperation[],
  watermark: number,
): ApplyResult {
  const ordered = [...operations].sort(
    (left, right) => left.serverRevision - right.serverRevision,
  );

  let serverRevision = watermark;
  const changedCells: number[] = [];

  for (const operation of ordered) {
    if (operation.serverRevision > serverRevision) {
      serverRevision = operation.serverRevision;
    }
    if (operation.cellIndex < 0 || operation.cellIndex >= completed.length) {
      continue;
    }
    const nextValue = operation.resolvedState === 'completed' ? 1 : 0;
    if (completed[operation.cellIndex] !== nextValue) {
      completed[operation.cellIndex] = nextValue;
      changedCells.push(operation.cellIndex);
    }
  }

  return { completed, serverRevision, changedCells };
}
