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
  findActiveSessionForPattern,
  getSession,
  deleteSession,
  StitchingSession,
  PatternSource,
  PendingPersonalPattern,
} from '../local-db';
import { apiFetch } from '../api/apiFetch';
import { Config } from '../config';

export class UnlockRequiredError extends Error {
  constructor(readonly patternId: string, readonly price: number) {
    super('unlock_required');
    this.name = 'UnlockRequiredError';
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

export function getOfflinePatternPath(patternId: string, identity: string | null): string {
  const baseDir = FileSystem.documentDirectory ?? '';
  const namespace = identity ? `namespace_guest_${identity}` : 'pre_identity';
  return `${baseDir}${namespace}/offline-patterns/${patternId}.bin`;
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

export function base64ToUint8Array(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  let bufferLength = Math.floor(len * 0.75);
  if (clean[len - 1] === '=') bufferLength--;
  if (clean[len - 2] === '=') bufferLength--;

  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const encoded1 = lookup[clean.charCodeAt(i)] ?? 0;
    const encoded2 = lookup[clean.charCodeAt(i + 1)] ?? 0;
    const encoded3 = lookup[clean.charCodeAt(i + 2)] ?? 0;
    const encoded4 = lookup[clean.charCodeAt(i + 3)] ?? 0;

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (p < bufferLength) {
      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    }
    if (p < bufferLength) {
      bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    result += chars[bytes[i] >> 2];
    result += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    result += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
    result += chars[bytes[i + 2] & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    result += chars[bytes[i] >> 2];
    result += chars[(bytes[i] & 3) << 4];
    result += '==';
  } else if (remaining === 2) {
    result += chars[bytes[i] >> 2];
    result += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    result += chars[(bytes[i + 1] & 15) << 2];
    result += '=';
  }
  return result;
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
// remoteSessionId, so progress stays local-only for it (the same degraded
// mode 'bundled' sessions always run in).
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

// Bundled patterns skip online Session Preparation (ADR 0037) but still
// follow the one-active-session-per-pattern rule, so repeated taps resume
// the same local session instead of inserting duplicates.
export async function prepareBundledSession(
  patternId: string,
  checksum: string,
): Promise<StitchingSession> {
  const existing = await findActiveSessionForPattern(patternId, 'bundled');
  if (existing) {
    return existing;
  }

  return createSession(patternId, checksum);
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
      await retryDownload(existing.id).catch(() => undefined);
    }
    return existing;
  }

  const response = await apiFetch('/v1/sessions/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patternId }),
  });

  if (!response.ok) {
    if (response.status === 403) {
      const body = await response.json().catch(() => null);
      if (body?.code === 'unlock_required') {
        throw new UnlockRequiredError(body.patternId ?? patternId, body.price ?? 0);
      }
    }
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
