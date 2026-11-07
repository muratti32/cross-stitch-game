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

interface PassOwner {
  identity: string;
  isAccount: boolean;
}

type RowResult = 'nextRow' | 'stopPass';
type LinkListener = (link: BundledSessionLink) => void;

const NO_CELLS_BITMAP = 'AA==';

const linkListeners = new Set<LinkListener>();
const refusedSessionIds = new Set<string>();
const unfinishedBitmaps = new Map<string, string>();
let runningPasses: Promise<void> | null = null;
let passRequested = false;

export function subscribeBundledSessionLinked(listener: LinkListener): () => void {
  linkListeners.add(listener);
  return () => {
    linkListeners.delete(listener);
  };
}

function currentOwner(): PassOwner | null {
  const { accountId, guestId, isAccount, isAuthenticated } = useIdentityStore.getState();
  const identity = isAccount ? accountId : guestId;
  if (!isAuthenticated || identity === null || identity !== getActiveIdentity()) return null;
  return { identity, isAccount };
}

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
  if (sent === null || unfinishedBitmaps.get(localSessionId) === sent.packedBitmapBase64) return 'nextRow';
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
    case 'registered': {
      const link = { localSessionId, remoteSessionId: outcome.sessionId };
      const receipt = {
        foldedThroughSeq: owner.isAccount ? sent.foldedThroughSeq : 0,
        checkpointRevision: sent.checkpointRevision,
        terminalCompleted: outcome.terminalCompleted,
      };
      const result = await linkBundledSession(owner.identity, link, receipt);
      if (result === 'linked') linkListeners.forEach((listener) => listener(link));
      // A row is marked completed before its final ops flush, so only the same
      // bitmap earns the same answer. A row sent in progress never said it finished.
      if (result === 'remoteSessionTaken') refusedSessionIds.add(localSessionId);
      if (result === 'sessionNotFinished' && sent.localState === 'completed') {
        unfinishedBitmaps.set(localSessionId, sent.packedBitmapBase64);
      }
      return 'nextRow';
    }
  }
}

async function runPass(): Promise<void> {
  const owner = currentOwner();
  if (owner === null) return;
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
