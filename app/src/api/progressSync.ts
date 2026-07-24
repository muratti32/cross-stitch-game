import { apiFetch } from './apiFetch';
import type { CellState } from '../sync/syncApply';

export interface OutgoingProgressOperation {
  opId: string;
  deviceSeq: number;
  cellIndex: number;
  desiredState: CellState;
  baseRevision: number;
}

export interface ProgressAck {
  opId: string;
  status: 'applied' | 'duplicate' | 'superseded';
}

export interface ServerProgressOperation {
  opId: string;
  deviceId: string;
  deviceSeq: number;
  cellIndex: number;
  desiredState: CellState;
  resolvedState: CellState;
  baseRevision: number;
  serverRevision: number;
  effective: boolean;
}

export interface ProgressSyncResponse {
  revision: number;
  terminalCompleted: boolean;
  acknowledgements: ProgressAck[];
  operations: ServerProgressOperation[];
}

export interface ProgressCompleteResponse {
  revision: number;
  terminalCompleted: boolean;
}

export interface ProgressCheckpoint {
  revision: number;
  checksumHex: string;
  formatVersion: number;
  deviceWatermarks: Record<string, number>;
  terminalCompleted: boolean;
  packedBitmapBase64: string;
}

/**
 * Pushes local operations and pulls the authoritative resolved operations for a
 * Registered Account session. Account-only (guest sessions never sync).
 */
export async function syncProgress(
  remoteSessionId: string,
  deviceId: string,
  sinceRevision: number,
  operations: OutgoingProgressOperation[],
): Promise<ProgressSyncResponse> {
  const response = await apiFetch(
    `/v1/sessions/${remoteSessionId}/progress/sync`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, sinceRevision, operations }),
    },
  );
  if (response.status !== 200) {
    throw await ProgressSyncError.fromResponse(
      `Progress sync failed: status ${response.status}`,
      response,
    );
  }
  return (await response.json()) as ProgressSyncResponse;
}

/**
 * Requests server-side validation of Session Completion. Resolves to the
 * terminal state; a 409 means the session is not fully stitched yet.
 */
export async function completeProgress(
  remoteSessionId: string,
  deviceId: string,
): Promise<ProgressCompleteResponse> {
  const response = await apiFetch(
    `/v1/sessions/${remoteSessionId}/progress/complete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    },
  );
  if (response.status !== 200) {
    throw await ProgressSyncError.fromResponse(
      `Progress completion failed: status ${response.status}`,
      response,
    );
  }
  return (await response.json()) as ProgressCompleteResponse;
}

/**
 * Fetches the latest folded checkpoint for a rebasing device, or null (204).
 */
export async function fetchProgressCheckpoint(
  remoteSessionId: string,
): Promise<ProgressCheckpoint | null> {
  const response = await apiFetch(
    `/v1/sessions/${remoteSessionId}/progress/checkpoint`,
  );
  if (response.status === 204) {
    return null;
  }
  if (response.status !== 200) {
    throw new ProgressSyncError(
      `Progress checkpoint fetch failed: status ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as ProgressCheckpoint;
}

export class ProgressSyncError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'ProgressSyncError';
    this.status = status;
    this.code = code;
  }

  static async fromResponse(message: string, response: Response): Promise<ProgressSyncError> {
    const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
    const code = typeof body?.code === 'string' ? body.code : null;
    return new ProgressSyncError(message, response.status, code);
  }
}
