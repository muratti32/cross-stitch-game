import { ProgressSyncError } from '../api/progressSync';
import { isOfflineNetworkError } from '../api/networkErrors';
import { loadBundledPattern } from '../bundled-patterns';
import { useIdentityStore } from '../identity/guestIdentity';
import {
  getActiveIdentity,
  getDeviceId,
  listSessionsWithUnackedProgressOps,
  updateSessionError,
  type StitchingSession,
} from '../local-db';
import { captureProgressSyncError } from '../observability/sentry';
import { handoffStore } from '../promotion/handoffStore';
import { deleteOfflinePatternFile } from '../session-preparation';
import { rebuildProgressBase } from './progressBase';
import { syncSession } from './progressSyncEngine';

type SessionResult = 'nextSession' | 'stopPass';

const PATTERN_REMOVED_NOTE = 'This Community Pattern was removed by moderation.';

const openSessionIds = new Set<string>();
// 404: not an account-owned session server-side. Skipped until the process restarts.
const refusedSessionIds = new Set<string>();
let syncing: { sessionId: string; work: Promise<SessionResult> } | null = null;
let runningPasses: Promise<void> | null = null;
let passRequested = false;

/** The session screen owns a session's live renderer while it is open. */
export function markSessionOpen(sessionId: string): void {
  openSessionIds.add(sessionId);
}

export function markSessionClosed(sessionId: string): void {
  openSessionIds.delete(sessionId);
}

/** Lets a session screen load the post-sync snapshot instead of racing the upload. */
export async function waitForBackgroundSync(sessionId: string): Promise<void> {
  if (syncing?.sessionId === sessionId) await syncing.work;
}

function isActiveAccount(): boolean {
  const { accountId, isAccount, isAuthenticated } = useIdentityStore.getState();
  return isAccount && isAuthenticated && accountId !== null && accountId === getActiveIdentity();
}

async function cellsLengthOf(session: StitchingSession): Promise<number | null> {
  if (session.patternWidth && session.patternHeight) return session.patternWidth * session.patternHeight;
  if (session.source !== 'bundled') return null;
  try {
    const pattern = await loadBundledPattern(session.patternId);
    return pattern.width * pattern.height;
  } catch {
    return null;
  }
}

async function uploadSession(session: StitchingSession, remoteSessionId: string): Promise<SessionResult> {
  try {
    const cellsLength = await cellsLengthOf(session);
    // The session screen still sizes this row from its pattern file.
    if (cellsLength === null) return 'nextSession';
    const { completed } = await rebuildProgressBase(session.id, cellsLength, true);
    await syncSession(session.id, remoteSessionId, await getDeviceId(), completed);
  } catch (error) {
    if (error instanceof ProgressSyncError && error.status === 404) {
      refusedSessionIds.add(session.id);
    } else if (error instanceof ProgressSyncError && error.code === 'pattern_removed') {
      refusedSessionIds.add(session.id);
      await updateSessionError(session.id, PATTERN_REMOVED_NOTE);
      await deleteOfflinePatternFile(session.patternId).catch(() => undefined);
    } else if (isOfflineNetworkError(error)) {
      return 'stopPass';
    } else {
      captureProgressSyncError('background-upload', error);
    }
  }
  return 'nextSession';
}

async function runPass(): Promise<void> {
  if (!isActiveAccount() || (await handoffStore.load()) !== null) return;

  for (const session of await listSessionsWithUnackedProgressOps()) {
    const { remoteSessionId } = session;
    if (!remoteSessionId || openSessionIds.has(session.id) || refusedSessionIds.has(session.id)) continue;
    const work = uploadSession(session, remoteSessionId);
    syncing = { sessionId: session.id, work };
    try {
      if ((await work) === 'stopPass') return;
    } finally {
      syncing = null;
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
  if (runningPasses !== null) {
    passRequested = true;
    return runningPasses;
  }
  runningPasses = (async () => {
    do {
      passRequested = false;
      await runPassReportingFailure();
    } while (passRequested);
    runningPasses = null;
  })();
  return runningPasses;
}
