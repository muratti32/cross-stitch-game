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
  ProgressSyncResponse,
} from '../api/progressSync';
import { applyResolvedOperations } from './syncApply';
import { markCriticalPathActivity } from '../perf/criticalPathSentinel';
import { queryClient } from '../providers';
import { coinBalanceQueryKey } from '../api/economy';

// Express refuses a JSON body over 100kb, about 780 operations.
const MAX_OPS_PER_SYNC = 500;
// The backend returns at most PULL_PAGE_SIZE (1000) operations per sync call;
// this bounds one syncSession to about 100k pulled operations.
const MAX_PULL_PAGES = 100;

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
  /** True when the pull stopped before the server ran out of operations; the next sync resumes. */
  pullIncomplete: boolean;
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
  markCriticalPathActivity('progress-sync', 'syncSession');
  const snapshot = await getSyncSnapshot(sessionId);
  let sinceRevision = snapshot?.serverRevision ?? 0;

  const unacked = await getUnackedProgressOps(sessionId);
  let outgoing: OutgoingProgressOperation[] = unacked.slice(0, MAX_OPS_PER_SYNC).map((op) => ({
    opId: op.opId,
    deviceSeq: op.deviceSeq,
    cellIndex: op.cellIndex,
    desiredState: op.desiredState,
    baseRevision: op.serverBaseRevision ?? 0,
  }));

  const changedCells = new Set<number>();
  const conflictedCells = new Set<number>();
  let serverRevision = sinceRevision;
  let terminalCompleted = false;
  let pullIncomplete = false;

  // The server returns one bounded page of operations per call. Keep pulling
  // (pushing nothing after the first page) until it says the pull is complete,
  // saving the snapshot per page so a watermark never passes applied ops.
  for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
    let response: ProgressSyncResponse;
    try {
      response = await syncProgress(remoteSessionId, deviceId, sinceRevision, outgoing);
    } catch (error) {
      // Earlier pages are already applied, saved and acked. Rethrowing would
      // hide them from the caller, so report what was applied and retry later.
      if (page === 0) throw error;
      pullIncomplete = true;
      break;
    }
    outgoing = [];

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

    const hasMore = response.hasMore === true;
    serverRevision = hasMore
      ? applied.serverRevision
      : Math.max(response.revision, applied.serverRevision);
    terminalCompleted = response.terminalCompleted;
    await saveSyncSnapshot(sessionId, serverRevision, completed, terminalCompleted);

    applied.changedCells.forEach((cell) => changedCells.add(cell));
    for (const operation of response.operations) {
      if (
        operation.deviceId === deviceId &&
        operation.resolvedState !== operation.desiredState
      ) {
        conflictedCells.add(operation.cellIndex);
      }
    }

    pullIncomplete = hasMore;
    if (!hasMore || serverRevision <= sinceRevision) break;
    sinceRevision = serverRevision;
  }

  return {
    serverRevision,
    terminalCompleted,
    pullIncomplete,
    changedCells: [...changedCells],
    conflictedCells: [...conflictedCells],
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
  markCriticalPathActivity('progress-sync', 'completeSession');
  const result = await completeProgress(remoteSessionId, deviceId);
  if (result.firstCompletionReward) {
    queryClient.invalidateQueries({ queryKey: coinBalanceQueryKey });
  }
  return result.terminalCompleted;
}
