import { apiFetch } from './apiFetch';
import { ProgressSyncError } from './progressSync';

export interface BundledRegistrationRequest {
  patternId: string;
  localState: 'in_progress' | 'completed';
  completedAt: string | null;
  /** Null for a Guest: the backend takes identity only from one (ADR-0037). */
  packedBitmapBase64: string | null;
}

export type BundledRegistrationOutcome =
  | { kind: 'registered'; sessionId: string; terminalCompleted: boolean }
  /** Not seeded yet, or a promotion holds the lock. The next trigger retries. */
  | { kind: 'deferred' }
  /** This backend will never take the row. */
  | { kind: 'notABundledStarter' }
  /** A backend older than the endpoint. */
  | { kind: 'unsupported' };

function refusalOutcome(status: number, code: string | null): BundledRegistrationOutcome | null {
  if (status === 409) return { kind: 'deferred' };
  if (status === 404 && code === 'starter_not_seeded') return { kind: 'deferred' };
  if (status === 404 && code === 'not_a_bundled_starter') return { kind: 'notABundledStarter' };
  if ((status === 404 || status === 405) && code === null) return { kind: 'unsupported' };
  return null;
}

function parseRegisteredSession(body: unknown): BundledRegistrationOutcome {
  if (typeof body === 'object' && body !== null) {
    const { sessionId, terminalCompleted } = body as Record<string, unknown>;
    if (typeof sessionId === 'string' && sessionId !== '' && typeof terminalCompleted === 'boolean') {
      return { kind: 'registered', sessionId, terminalCompleted };
    }
  }
  throw new Error('Bundled session registration returned an unreadable session');
}

/** Throws on any failure the registrar cannot act on, and when offline. */
export async function registerBundledSessionRemote(
  request: BundledRegistrationRequest,
): Promise<BundledRegistrationOutcome> {
  const response = await apiFetch('/v1/sessions/bundled', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (response.status === 200) {
    return parseRegisteredSession(await response.json());
  }
  const failure = await ProgressSyncError.fromResponse(
    `Bundled session registration failed: status ${response.status}`,
    response,
  );
  const outcome = refusalOutcome(failure.status, failure.code);
  if (outcome === null) throw failure;
  return outcome;
}
