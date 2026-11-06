import { registerBundledSessionRemote, type BundledRegistrationRequest } from '../api/bundledSessions';
import { isOfflineNetworkError } from '../api/networkErrors';
import { useIdentityStore } from '../identity/guestIdentity';
import {
  getActiveIdentity,
  linkBundledSession,
  listBundledRegistrationCandidates,
  readBundledRegistrationSnapshot,
  type BundledRegistrationSnapshot,
  type BundledSessionLink,
} from '../local-db';
import { captureBundledRegistrationError } from '../observability/sentry';
import { handoffStore } from '../promotion/handoffStore';

/** Whose rows one pass registers. Both fields are read once, at the start. */
interface PassOwner {
  identity: string;
  isAccount: boolean;
}

type RowResult = 'nextRow' | 'stopPass';
type LinkListener = (link: BundledSessionLink) => void;

/** The backend requires a bitmap from an account, and an untouched row folds to an empty one. */
const NO_CELLS_BITMAP = 'AA==';

const linkListeners = new Set<LinkListener>();
const refusedSessionIds = new Set<string>();
let backendLacksEndpoint = false;
let runningPasses: Promise<void> | null = null;
let passRequested = false;

/** Tells an open session the row it shows now has a backend identity. */
export function subscribeBundledSessionLinked(listener: LinkListener): () => void {
  linkListeners.add(listener);
  return () => {
    linkListeners.delete(listener);
  };
}

/** The store and the open namespace disagree for a moment during an identity switch. */
function currentOwner(): PassOwner | null {
  const { accountId, guestId, isAccount, isAuthenticated } = useIdentityStore.getState();
  const identity = isAccount ? accountId : guestId;
  if (!isAuthenticated || identity === null || identity !== getActiveIdentity()) return null;
  return { identity, isAccount };
}

/**
 * An account registers every row with its bitmap. A Guest registers identity
 * only, because a completed Guest session is evidence for a pending reward at
 * promotion; its completed rows stay local and reach the account in the package.
 */
function requestFor(owner: PassOwner, snapshot: BundledRegistrationSnapshot): BundledRegistrationRequest | null {
  const { patternId, localState, completedAt, packedBitmapBase64 } = snapshot;
  if (owner.isAccount) {
    return { patternId, localState, completedAt, packedBitmapBase64: packedBitmapBase64 || NO_CELLS_BITMAP };
  }
  if (localState === 'completed') return null;
  return { patternId, localState, completedAt: null, packedBitmapBase64: null };
}

async function registerRow(owner: PassOwner, localSessionId: string): Promise<RowResult> {
  let sent = await readBundledRegistrationSnapshot(localSessionId);
  if (sent === null) return 'nextRow';
  const request = requestFor(owner, sent);
  if (request === null) return 'nextRow';

  let outcome = await registerBundledSessionRemote(request);
  if (outcome.kind === 'registered' && sent.localState === 'in_progress') {
    const latest = await readBundledRegistrationSnapshot(localSessionId);
    if (latest === null) return 'nextRow';
    if (latest.localState === 'completed') {
      const finishing = requestFor(owner, latest);
      if (finishing === null) return 'nextRow';
      sent = latest;
      outcome = await registerBundledSessionRemote(finishing);
    }
  }

  switch (outcome.kind) {
    case 'deferred':
      return 'stopPass';
    case 'notABundledStarter':
      refusedSessionIds.add(localSessionId);
      return 'nextRow';
    case 'unsupported':
      backendLacksEndpoint = true;
      return 'stopPass';
    case 'registered': {
      const link = { localSessionId, remoteSessionId: outcome.sessionId };
      // Linking last lets a crash at any earlier point rerun from the top.
      if (await linkBundledSession(owner.identity, link, owner.isAccount ? sent.foldedThroughSeq : 0)) {
        linkListeners.forEach((listener) => listener(link));
      }
      return 'nextRow';
    }
  }
}

async function runPass(): Promise<void> {
  if (backendLacksEndpoint) return;
  const owner = currentOwner();
  if (owner === null) return;
  // The handoff's manifest must not change under a capture or a drain.
  if ((await handoffStore.load()) !== null) return;

  for (const localSessionId of await listBundledRegistrationCandidates()) {
    if (refusedSessionIds.has(localSessionId)) continue;
    if ((await registerRow(owner, localSessionId)) === 'stopPass') return;
  }
}

async function runPassReportingFailure(): Promise<void> {
  try {
    await runPass();
  } catch (error) {
    if (!isOfflineNetworkError(error)) captureBundledRegistrationError(error);
  }
}

/**
 * The only writer of a bundled session's link. Safe from any trigger: passes never
 * overlap, a call during a pass asks for one more, and it never rejects.
 */
export function registerBundledSessions(): Promise<void> {
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
