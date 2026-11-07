import { ProgressSyncError } from '../api/progressSync';
import { isOfflineNetworkError } from '../api/networkErrors';
import { loadBundledPattern } from '../bundled-patterns';
import { useIdentityStore } from '../identity/guestIdentity';
import {
  getActiveIdentity,
  getDeviceId,
  listSessionsWithUnackedProgressOps,
  getUnackedProgressOps,
  type StitchingSession,
} from '../local-db';
import { addProgressSyncBreadcrumb, captureProgressSyncError } from '../observability/sentry';
import { handoffStore } from '../promotion/handoffStore';
import { applyPatternRemoval } from './patternRemoval';
import { rebuildProgressBase } from './progressBase';
import { syncSession } from './progressSyncEngine';

type SessionResult = 'nextSession' | 'stopPass';
interface PassOwner {
  accountId: string;
}

const openSessionCounts = new Map<string, number>();
// 404: not an account-owned session server-side. Skipped until the process restarts.
const refusedSessionIds = new Set<string>();
let activeUpload: { sessionId: string; work: Promise<SessionResult> } | null = null;
let activePass: Promise<void> | null = null;
let passRequested = false;

/** The session screen owns a session's live renderer while it is open. */
export function markSessionOpen(sessionId: string): void {
  openSessionCounts.set(sessionId, (openSessionCounts.get(sessionId) ?? 0) + 1);
}

export function markSessionClosed(sessionId: string): void {
  const count = (openSessionCounts.get(sessionId) ?? 0) - 1;
  if (count > 0) openSessionCounts.set(sessionId, count);
  else openSessionCounts.delete(sessionId);
}

/** Lets a session screen load the post-sync snapshot instead of racing the upload. */
export async function waitForBackgroundSync(sessionId: string): Promise<void> {
  if (activeUpload?.sessionId === sessionId) await activeUpload.work.catch(() => undefined);
}

function currentOwner(): PassOwner | null {
  const { accountId, isAccount, isAuthenticated } = useIdentityStore.getState();
  if (!isAccount || !isAuthenticated || accountId === null || accountId !== getActiveIdentity()) return null;
  return { accountId };
}

// The pass belongs to the account it started for; a switch or a promotion
// handoff ends it before anything is read from or written to another namespace.
async function passStillAllowed(owner: PassOwner): Promise<boolean> {
  try {
    return currentOwner()?.accountId === owner.accountId && (await handoffStore.load()) === null;
  } catch (error) {
    captureProgressSyncError('background-upload', error);
    return false;
  }
}

async function cellsLengthOf(session: StitchingSession): Promise<number | null> {
  if (session.patternWidth && session.patternHeight) return session.patternWidth * session.patternHeight;
  if (session.source !== 'bundled') return null;
  try {
    const pattern = await loadBundledPattern(session.patternId);
    return pattern.width * pattern.height;
  } catch (error) {
    captureProgressSyncError('background-upload-size', error);
    return null;
  }
}

async function uploadSession(
  owner: PassOwner,
  session: StitchingSession,
  remoteSessionId: string,
): Promise<SessionResult> {
  try {
    const cellsLength = await cellsLengthOf(session);
    if (cellsLength === null) {
      // The session screen still sizes this row from its pattern file.
      addProgressSyncBreadcrumb('Background upload skipped a session of unknown size', { sessionId: session.id });
      return 'nextSession';
    }
    // One sync carries a bounded batch of ops: go on while the backlog shrinks.
    let remaining = Number.POSITIVE_INFINITY;
    for (;;) {
      const base = await rebuildProgressBase(session.id, cellsLength, true);
      if (base.snapshotBytes !== null && base.snapshotBytes > Math.ceil(cellsLength / 8)) {
        addProgressSyncBreadcrumb('Background upload skipped a session whose snapshot is larger than its pattern', {
          sessionId: session.id,
        });
        return 'nextSession';
      }
      const deviceId = await getDeviceId();
      if (!(await passStillAllowed(owner))) return 'stopPass';
      if (openSessionCounts.has(session.id)) return 'nextSession';
      // One pull page keeps a screen waiting on this upload short; its own sync pulls the rest.
      await syncSession(session.id, remoteSessionId, deviceId, base.completed, { maxPullPages: 1 });

      const { length } = await getUnackedProgressOps(session.id);
      if (length === 0 || length >= remaining) return 'nextSession';
      remaining = length;
    }
  } catch (error) {
    if (!(await passStillAllowed(owner))) return 'stopPass';
    if (error instanceof ProgressSyncError && error.status === 404) {
      refusedSessionIds.add(session.id);
    } else if (error instanceof ProgressSyncError && error.code === 'pattern_removed') {
      refusedSessionIds.add(session.id);
      await removePatternLocally(session);
    } else if (isOfflineNetworkError(error)) {
      return 'stopPass';
    } else {
      captureProgressSyncError('background-upload', error);
    }
  }
  return 'nextSession';
}

async function removePatternLocally(session: StitchingSession): Promise<void> {
  try {
    await applyPatternRemoval(session);
  } catch (error) {
    captureProgressSyncError('background-upload', error);
  }
}

async function runPass(): Promise<void> {
  const owner = currentOwner();
  if (owner === null || !(await passStillAllowed(owner))) return;

  for (const session of await listSessionsWithUnackedProgressOps()) {
    const { remoteSessionId } = session;
    if (!remoteSessionId || openSessionCounts.has(session.id) || refusedSessionIds.has(session.id)) continue;
    if (!(await passStillAllowed(owner))) return;
    // A screen opened during the check above still sees this as in flight.
    if (openSessionCounts.has(session.id)) continue;
    const work = uploadSession(owner, session, remoteSessionId);
    activeUpload = { sessionId: session.id, work };
    try {
      if ((await work) === 'stopPass') return;
    } finally {
      activeUpload = null;
    }
  }
}

async function runPassReportingFailure(): Promise<void> {
  try {
    await runPass();
  } catch (error) {
    if (!isOfflineNetworkError(error)) captureProgressSyncError('background-upload', error);
  }
}

/**
 * Uploads the unacknowledged progress of linked account sessions without a
 * session screen open. Never throws; overlapping calls share one pass and one
 * rerun covers requests made while it ran.
 */
export function uploadPendingProgress(): Promise<void> {
  if (activePass !== null) {
    passRequested = true;
    return activePass;
  }
  activePass = (async () => {
    do {
      passRequested = false;
      await runPassReportingFailure();
    } while (passRequested);
    activePass = null;
  })();
  return activePass;
}
