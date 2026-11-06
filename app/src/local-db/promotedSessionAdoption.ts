import type { DrainSessionResult, PackagedSession } from '../api/promotionContract';

/** What the backend says survives for a drained session. */
export type PromotedSessionServerState = Pick<
  DrainSessionResult,
  'accountSessionId' | 'revision' | 'packedBitmapBase64' | 'terminalCompleted'
>;

/** The account namespace's records that decide how a packaged session lands. */
export interface AccountSessionLookup {
  /** A row already holds this session: same local id, or same server session. */
  alreadyAdopted: boolean;
  /** The account's unfinished session on the same pattern and source. */
  activeSessionId: string | null;
}

export type PromotedSessionAdoption =
  | { kind: 'keepAccountRow' }
  | { kind: 'mergeIntoActive'; sessionId: string; packedBitmapBase64: string }
  | {
      kind: 'insert';
      remoteSessionId: string | null;
      status: PackagedSession['status'];
      completedAt: string | null;
      packedBitmapBase64: string;
      syncSnapshot: { serverRevision: number; terminal: boolean } | null;
    };

/**
 * Promotion Session Merge on the device. A server session is merged by the
 * backend, so only a session with no surviving server row can meet the account's
 * active session here. A completed Guest session stays its own history entry.
 */
export function planPromotedSessionAdoption(
  session: PackagedSession,
  server: PromotedSessionServerState | null,
  account: AccountSessionLookup,
): PromotedSessionAdoption {
  if (account.alreadyAdopted) return { kind: 'keepAccountRow' };

  const remoteSessionId = server?.accountSessionId ?? null;
  if (remoteSessionId === null) {
    if (session.status !== 'completed' && account.activeSessionId !== null) {
      return { kind: 'mergeIntoActive', sessionId: account.activeSessionId, packedBitmapBase64: session.packedBitmapBase64 };
    }
    return {
      kind: 'insert',
      remoteSessionId: null,
      status: session.status,
      completedAt: session.completedAt,
      packedBitmapBase64: session.packedBitmapBase64,
      syncSnapshot: null,
    };
  }

  const terminal = server?.terminalCompleted ?? false;
  const serverBitmap = server?.packedBitmapBase64 ?? '';
  return {
    kind: 'insert',
    remoteSessionId,
    status: terminal ? 'completed' : session.status,
    completedAt: terminal ? (session.completedAt ?? session.updatedAt) : session.completedAt,
    packedBitmapBase64: serverBitmap !== '' ? serverBitmap : session.packedBitmapBase64,
    syncSnapshot:
      serverBitmap !== '' ? { serverRevision: server?.revision ?? 0, terminal } : null,
  };
}
