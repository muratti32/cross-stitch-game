import {
  getLatestCheckpoint,
  getProgressOps,
  getSyncSnapshot,
  getUnackedProgressOps,
  unpackCompletedBitmap,
} from '../local-db';

export interface ProgressBase {
  completed: Uint8Array;
  /** Server revision of the folded snapshot; null when the base is local-only. */
  serverRevision: number | null;
  /** Byte length of the folded snapshot bitmap; null when there is none. */
  snapshotBytes: number | null;
  /** Local op revision the base reaches. */
  sessionRevision: number;
}

/**
 * Rebuilds the completed bitmap a session reloads from. A synced account
 * session starts from the server-folded snapshot plus this device's unacked
 * ops; anything else (guests, never-synced rows) from the latest checkpoint
 * plus newer local ops.
 */
export async function rebuildProgressBase(
  sessionId: string,
  cellsLength: number,
  accountSession: boolean,
): Promise<ProgressBase> {
  const snapshot = accountSession ? await getSyncSnapshot(sessionId) : null;
  if (snapshot) {
    const completed = unpackCompletedBitmap(snapshot.packedBitmap, cellsLength);
    const sessionRevision = (await getLatestCheckpoint(sessionId))?.revision ?? 0;
    for (const op of await getUnackedProgressOps(sessionId)) {
      if (op.cellIndex >= 0 && op.cellIndex < cellsLength) {
        completed[op.cellIndex] = op.desiredState === 'completed' ? 1 : 0;
      }
    }
    return {
      completed,
      serverRevision: snapshot.serverRevision,
      snapshotBytes: snapshot.packedBitmap.length,
      sessionRevision,
    };
  }

  const checkpoint = await getLatestCheckpoint(sessionId);
  let sessionRevision = 0;
  let completed: Uint8Array;
  if (checkpoint) {
    completed = unpackCompletedBitmap(checkpoint.packedBitmap, cellsLength);
    sessionRevision = checkpoint.revision;
  } else {
    completed = new Uint8Array(cellsLength);
  }
  for (const op of await getProgressOps(sessionId, checkpoint?.revision ?? 0)) {
    if (op.cellIndex >= 0 && op.cellIndex < cellsLength) {
      completed[op.cellIndex] = op.desiredState === 'completed' ? 1 : 0;
      sessionRevision++;
    }
  }
  return { completed, serverRevision: null, snapshotBytes: null, sessionRevision };
}
