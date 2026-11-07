import * as FileSystem from 'expo-file-system/legacy';
import { create } from 'zustand';
import { sha256 } from 'js-sha256';
import { decodePatternArtifact, encodePatternArtifact, type PatternData } from '../pattern-artifact';
import {
  updateSessionStatus,
  updateSessionError,
  addPendingCancel,
  removePendingCancel,
  getActiveIdentity,
  createSession,
  linkPreparedSession,
  findActiveSessionForPattern,
  getSession,
  deleteSession,
  StitchingSession,
  PatternSource,
  PendingPersonalPattern,
} from '../local-db';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../local-db/helpers';
import { apiFetch } from '../api/apiFetch';
import { Config } from '../config';
import { isUnlockRequiredNote, UNLOCK_REQUIRED_NOTE } from './unlockRequiredNote';
import { registerBundledSessions } from '../sync/bundledSessionRegistrar';

export class UnlockRequiredError extends Error {
  constructor(readonly patternId: string, readonly price: number | null) {
    super(UNLOCK_REQUIRED_NOTE);
    this.name = 'UnlockRequiredError';
  }
}

interface UnlockRequiredBody {
  code?: string;
  patternId?: string;
  price?: number;
}

async function throwIfUnlockRequired(response: Response, patternId: string): Promise<void> {
  if (response.status !== 403) return;
  const body = (await response.json().catch(() => null)) as UnlockRequiredBody | null;
  if (body?.code === UNLOCK_REQUIRED_NOTE) {
    throw new UnlockRequiredError(body.patternId ?? patternId, body.price ?? null);
  }
}

interface DownloadProgressState {
  progress: Record<string, number>;
  setProgress: (sessionId: string, value: number) => void;
  clearProgress: (sessionId: string) => void;
}

export const useDownloadProgressStore = create<DownloadProgressState>((set) => ({
  progress: {},
  setProgress: (sessionId, value) =>
    set((state) => ({
      progress: { ...state.progress, [sessionId]: value },
    })),
  clearProgress: (sessionId) =>
    set((state) => {
      const copy = { ...state.progress };
      delete copy[sessionId];
      return { progress: copy };
    }),
}));

const activeDownloads = new Map<string, FileSystem.DownloadResumable>();

export { base64ToUint8Array, uint8ArrayToBase64 };

export function getOfflinePatternPath(patternId: string, identity: string | null): string {
  const baseDir = FileSystem.documentDirectory ?? '';
  const namespace = identity ? `namespace_guest_${identity}` : 'pre_identity';
  return `${baseDir}${namespace}/offline-patterns/${patternId}.bin`;
}

/**
 * Copies Offline Pattern Data between Local Identity Namespaces for a session
 * that has no server session to re-download it from. Idempotent, and the file
 * only appears under its final name once complete, so a kill mid-copy cannot
 * leave a truncated artifact that later reads as present. A missing source is
 * not an error: the session was already unopenable before the copy.
 */
export async function copyOfflinePatternToNamespace(
  patternId: string,
  fromIdentity: string,
  toIdentity: string,
): Promise<void> {
  const from = getOfflinePatternPath(patternId, fromIdentity);
  const to = getOfflinePatternPath(patternId, toIdentity);
  if ((await FileSystem.getInfoAsync(to)).exists) return;
  if (!(await FileSystem.getInfoAsync(from)).exists) return;
  await FileSystem.makeDirectoryAsync(to.substring(0, to.lastIndexOf('/')), { intermediates: true });
  const partial = `${to}.partial`;
  await FileSystem.deleteAsync(partial, { idempotent: true });
  await FileSystem.copyAsync({ from, to: partial });
  await FileSystem.moveAsync({ from: partial, to });
}

/**
 * Deletes this device's cached Offline Pattern Data for a Pattern, e.g. when
 * the backend delivers a Safety Removal deletion instruction. Idempotent: a
 * missing file is not an error.
 */
export async function deleteOfflinePatternFile(patternId: string): Promise<void> {
  const identity = getActiveIdentity();
  const path = getOfflinePatternPath(patternId, identity);
  await FileSystem.deleteAsync(path, { idempotent: true });
}

export interface PrepareResponse {
  sessionId: string;
  patternId: string;
  artifact: {
    checksum: string;
    byteLength: number;
    schemaVersion: number;
  };
  grant: {
    url: string;
    expiresAt: string;
  };
}

export interface PreparePatternInfo {
  title: string;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  width: number;
  height: number;
}

export async function prepareCatalogSession(
  patternId: string,
  patternInfo: PreparePatternInfo,
): Promise<StitchingSession> {
  return prepareRemoteSession(patternId, patternInfo, 'catalog');
}

export async function preparePersonalSession(
  patternId: string,
  patternInfo: PreparePatternInfo,
): Promise<StitchingSession> {
  return prepareRemoteSession(patternId, patternInfo, 'personal');
}

// An offline-created Pending Personal Pattern already has its full grid+palette
// known locally (written by the editor's Save-as-New offline fallback), so it
// can be encoded into the same artifact format used for synced patterns and
// played immediately, with zero network round-trip. Once the backend sync
// succeeds later, this local session is unaffected; it simply has no
// remoteSessionId, so progress stays local-only for it.
export async function preparePendingPersonalSession(
  pending: PendingPersonalPattern,
): Promise<StitchingSession> {
  const existing = await findActiveSessionForPattern(pending.patternId, 'personal');
  if (existing) {
    return existing;
  }

  const patternData: PatternData = {
    schemaVersion: 1,
    width: pending.width,
    height: pending.height,
    palette: pending.palette,
    grid: base64ToUint8Array(pending.gridBase64),
  };
  const bytes = encodePatternArtifact(patternData);
  const checksum = sha256(bytes);

  const identity = getActiveIdentity();
  const destPath = getOfflinePatternPath(pending.patternId, identity);
  const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
  await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });
  await FileSystem.writeAsStringAsync(destPath, uint8ArrayToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });

  return createSession(pending.patternId, checksum, 'personal', 'ready', null, {
    title: pending.title,
    previewUrl: null,
    thumbnailUrl: null,
    width: pending.width,
    height: pending.height,
  });
}

const bundledPreparationInFlight = new Map<string, Promise<StitchingSession>>();

// Bundled patterns skip online Session Preparation (ADR 0037) but still
// follow the one-active-session-per-pattern rule, so repeated taps resume
// the same local session instead of inserting duplicates.
export async function prepareBundledSession(
  patternId: string,
  checksum: string,
): Promise<StitchingSession> {
  const current = bundledPreparationInFlight.get(patternId);
  if (current) return current;

  const preparation = (async () => {
    const existing =
      (await findActiveSessionForPattern(patternId, 'bundled')) ??
      (await findActiveSessionForPattern(patternId, 'catalog'));
    if (existing) return existing;

    const created = await createSession(patternId, checksum);
    void registerBundledSessions();
    return created;
  })();
  bundledPreparationInFlight.set(patternId, preparation);

  try {
    return await preparation;
  } finally {
    if (bundledPreparationInFlight.get(patternId) === preparation) {
      bundledPreparationInFlight.delete(patternId);
    }
  }
}

// Rows the server answered with a session another row holds: they play unlinked
// and take the server session the next prepare hands out once the holder closed.
const rowsAwaitingServerSession = new Set<string>();

async function linkAwaitingRow(localSessionId: string, patternId: string): Promise<void> {
  try {
    const response = await apiFetch('/v1/sessions/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patternId }),
    });
    if (!response.ok) return;
    const data = (await response.json()) as PrepareResponse;
    if (await linkPreparedSession(localSessionId, data.sessionId)) {
      rowsAwaitingServerSession.delete(localSessionId);
    }
  } catch {
    // Offline or refused: the row keeps playing locally and retries on the next start.
  }
}

async function prepareRemoteSession(
  patternId: string,
  patternInfo: PreparePatternInfo,
  source: Extract<PatternSource, 'catalog' | 'personal'>,
): Promise<StitchingSession> {
  // Prepare is idempotent on (identity, pattern) server-side; mirror that
  // locally so repeated taps resume the same local session instead of
  // inserting duplicates.
  const existing = await findActiveSessionForPattern(patternId, source);
  if (existing) {
    if (existing.status === 'preparing') {
      await retryDownload(existing.id).catch((err: unknown) => {
        if (err instanceof UnlockRequiredError) throw err;
      });
    }
    if (existing.remoteSessionId == null && rowsAwaitingServerSession.has(existing.id)) {
      await linkAwaitingRow(existing.id, patternId);
    }
    return existing;
  }

  const response = await apiFetch('/v1/sessions/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patternId }),
  });

  if (!response.ok) {
    await throwIfUnlockRequired(response, patternId);
    if (response.status === 409) {
      throw new Error('Pattern is not available');
    }
    throw new Error(`Failed to prepare session: ${response.status}`);
  }

  const data = (await response.json()) as PrepareResponse;

  const session = await createSession(
    patternId,
    data.artifact.checksum,
    source,
    'preparing',
    data.sessionId,
    patternInfo,
  );

  if (session.remoteSessionId == null) rowsAwaitingServerSession.add(session.id);

  void downloadAndRegister(session.id, patternId, data.grant.url, data.artifact.checksum);

  return session;
}

export async function waitUntilSessionReady(
  localSessionId: string,
  timeoutMilliseconds = 90_000,
): Promise<StitchingSession> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const session = await getSession(localSessionId);
    if (session === null) {
      throw new Error('Prepared session disappeared');
    }
    if (session.status !== 'preparing') {
      return session;
    }
    if (isUnlockRequiredNote(session.errorNote)) {
      throw new UnlockRequiredError(session.patternId, null);
    }
    if (session.errorNote) {
      throw new Error(session.errorNote);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    'Pattern is still downloading. Open it from the Play tab shortly.',
  );
}

export async function retryDownload(localSessionId: string): Promise<void> {
  const session = await getSession(localSessionId);
  if (!session || !session.remoteSessionId) {
    throw new Error('Local session not found or invalid');
  }

  await updateSessionStatus(localSessionId, 'preparing');

  try {
    const response = await apiFetch(`/v1/sessions/${session.remoteSessionId}/refresh-grant`, {
      method: 'POST',
    });

    if (!response.ok) {
      await throwIfUnlockRequired(response, session.patternId);
      throw new Error(`Failed to refresh grant: ${response.status}`);
    }

    const data = (await response.json()) as PrepareResponse;

    void downloadAndRegister(localSessionId, session.patternId, data.grant.url, session.artifactChecksum);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateSessionError(localSessionId, msg);
    throw err;
  }
}

export async function cancelDownload(localSessionId: string): Promise<void> {
  const session = await getSession(localSessionId);
  if (!session) return;

  const activeDownload = activeDownloads.get(localSessionId);
  if (activeDownload) {
    try {
      await activeDownload.cancelAsync();
    } catch (e) {
      console.warn('Failed to cancel active download:', e);
    }
    activeDownloads.delete(localSessionId);
  }

  useDownloadProgressStore.getState().clearProgress(localSessionId);

  const tempPath = `${FileSystem.cacheDirectory}prep_${localSessionId}.tmp`;
  try {
    await FileSystem.deleteAsync(tempPath, { idempotent: true });
  } catch (e) {
    console.warn('Failed to delete temp file during cancel:', e);
  }

  const remoteSessionId = session.remoteSessionId;
  await deleteSession(localSessionId);

  if (remoteSessionId) {
    try {
      const response = await apiFetch(`/v1/sessions/${remoteSessionId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        await addPendingCancel(remoteSessionId);
      }
    } catch (err) {
      await addPendingCancel(remoteSessionId);
    }
  }
}

export async function syncPendingCancels(): Promise<void> {
  const db = await import('../local-db');
  const pending = await db.getPendingCancels();
  for (const remoteSessionId of pending) {
    try {
      const response = await apiFetch(`/v1/sessions/${remoteSessionId}`, {
        method: 'DELETE',
      });
      if (response.ok || response.status === 404) {
        await db.removePendingCancel(remoteSessionId);
      }
    } catch (err) {
      // best effort, try again later
    }
  }
}

async function downloadAndRegister(
  localSessionId: string,
  patternId: string,
  grantUrl: string,
  checksum: string,
): Promise<void> {
  const tempPath = `${FileSystem.cacheDirectory}prep_${localSessionId}.tmp`;
  const identity = getActiveIdentity();
  const destPath = getOfflinePatternPath(patternId, identity);

  try {
    const url = grantUrl.startsWith('http') ? grantUrl : `${Config.apiBaseUrl}${grantUrl}`;
    const downloadResumable = FileSystem.createDownloadResumable(
      url,
      tempPath,
      {},
      (downloadProgress) => {
        const progress =
          downloadProgress.totalBytesExpectedToWrite > 0
            ? downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite
            : 0;
        useDownloadProgressStore.getState().setProgress(localSessionId, progress);
      },
    );
    activeDownloads.set(localSessionId, downloadResumable);

    const result = await downloadResumable.downloadAsync();
    activeDownloads.delete(localSessionId);

    if (!result || !result.uri) {
      throw new Error('Download failed');
    }

    const base64Str = await FileSystem.readAsStringAsync(result.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToUint8Array(base64Str);

    decodePatternArtifact(bytes, checksum);

    const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
    await FileSystem.makeDirectoryAsync(destDir, { intermediates: true });
    await FileSystem.moveAsync({
      from: result.uri,
      to: destPath,
    });

    useDownloadProgressStore.getState().clearProgress(localSessionId);
    await updateSessionStatus(localSessionId, 'ready');
  } catch (error) {
    activeDownloads.delete(localSessionId);
    useDownloadProgressStore.getState().clearProgress(localSessionId);
    const msg = error instanceof Error ? error.message : String(error);
    await updateSessionError(localSessionId, msg);
  }
}
