import {
  getUnackedProgressOps,
  getSyncSnapshot,
  saveSyncSnapshot,
  markProgressOpsAcked,
} from '../local-db';
import {
  syncProgress,
  completeProgress,
  OutgoingProgressOperation,
} from '../api/progressSync';
import { applyResolvedOperations } from './syncApply';

export interface SyncOutcome {
  /** Authoritative server revision after this sync. */
  serverRevision: number;
  /** Whether the session has reached terminal completion server-side. */
  terminalCompleted: boolean;
  /** Cells whose local value the server changed (foreign edits + own corrections). */
  changedCells: number[];
  /**
   * Cells where this device's own just-uploaded op was overridden by the server
   * (genuinely-concurrent completed-wins). Drives the single conflict notice.
   */
  conflictedCells: number[];
}

/**
 * Runs one push+pull sync cycle for an account session and folds the
 * authoritative result into `completed` (mutated in place) and the local sync
 * snapshot. Guest sessions never call this. Serialized per session by the
 * caller (the hook drives it from its flush/lifecycle points).
 */
export async function syncSession(
  sessionId: string,
  remoteSessionId: string,
  deviceId: string,
  completed: Uint8Array,
): Promise<SyncOutcome> {
  const snapshot = await getSyncSnapshot(sessionId);
  const sinceRevision = snapshot?.serverRevision ?? 0;

  const unacked = await getUnackedProgressOps(sessionId);
  const outgoing: OutgoingProgressOperation[] = unacked.map((op) => ({
    opId: op.opId,
    deviceSeq: op.deviceSeq,
    cellIndex: op.cellIndex,
    desiredState: op.desiredState,
    baseRevision: op.serverBaseRevision ?? 0,
  }));

  const response = await syncProgress(
    remoteSessionId,
    deviceId,
    sinceRevision,
    outgoing,
  );

  // Every acknowledged op (applied, duplicate, or superseded) is now owned by
  // the server and folded into the snapshot below, so it is safe to drop locally.
  const ackedIds = response.acknowledgements.map((ack) => ack.opId);
  await markProgressOpsAcked(ackedIds);

  const applied = applyResolvedOperations(
    completed,
    response.operations.map((operation) => ({
      cellIndex: operation.cellIndex,
      resolvedState: operation.resolvedState,
      serverRevision: operation.serverRevision,
    })),
    sinceRevision,
  );

  const serverRevision = Math.max(response.revision, applied.serverRevision);
  await saveSyncSnapshot(
    sessionId,
    serverRevision,
    completed,
    response.terminalCompleted,
  );

  const conflictedCells = response.operations
    .filter(
      (operation) =>
        operation.deviceId === deviceId &&
        operation.resolvedState !== operation.desiredState,
    )
    .map((operation) => operation.cellIndex);

  return {
    serverRevision,
    terminalCompleted: response.terminalCompleted,
    changedCells: applied.changedCells,
    conflictedCells,
  };
}

/**
 * Asks the server to validate and finalize Session Completion. Returns the
 * terminal state; callers treat a thrown ProgressSyncError(409) as "not yet
 * fully stitched server-side" and simply retry on the next sync.
 */
export async function completeSession(
  remoteSessionId: string,
  deviceId: string,
): Promise<boolean> {
  const result = await completeProgress(remoteSessionId, deviceId);
  return result.terminalCompleted;
}
