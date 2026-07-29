import {
  getAccessToken,
  refreshSession,
  handleAccountDeletedIdempotently,
  handleAuthenticationRequired,
} from '../identity/guestIdentity';
import { performAuthenticatedRequest } from './authenticatedRequest';
import { markCriticalPathActivity } from '../perf/criticalPathSentinel';

export interface ApiFetchOptions extends RequestInit {
  // Add any custom options if needed in the future
}

/**
 * An authenticated wrapper around fetch.
 * Automatically attaches the Bearer access token if present.
 * Intercepts 401 Unauthorized status, performs a single-flight token refresh,
 * and replays the original request.
 */
export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  markCriticalPathActivity('network', path);
  return performAuthenticatedRequest(path, options, {
    getAccessToken,
    refreshSession,
    onAccountDeleted: handleAccountDeletedIdempotently,
    onAuthenticationRequired: handleAuthenticationRequired,
  });
}
