import { Config } from '../config';
import { isOfflineNetworkError, OfflineError } from './networkErrors';
import { getActiveLocale } from '../i18n/activeLocale';

export interface AuthSessionProvider {
  getAccessToken: () => string | null;
  refreshSession: () => Promise<string>;
  onAccountDeleted?: () => Promise<void>;
  onAuthenticationRequired?: () => Promise<void>;
}

export class AccountClosingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountClosingError';
  }
}

let accountDeletionTriggered = false;

export function resetAccountDeletionTrigger(): void {
  accountDeletionTriggered = false;
}

/**
 * Attaches the active App Display Language to a request URL as the
 * existing `locale` query parameter (#160) - centrally, here, so no
 * individual call site (catalog or otherwise) has to build its own `locale`
 * param. The Game Backend already reads `?locale=` on catalog endpoints and
 * ignores unrecognized query params elsewhere, so attaching it uniformly to
 * every request needs no endpoint-specific branching.
 */
function withActiveLocale(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}locale=${getActiveLocale()}`;
}

/**
 * Runs `fetch` and converts a thrown connectivity failure into a typed,
 * catchable `OfflineError` instead of letting the platform's raw `Error`
 * (message text varies by OS/RN version - see networkErrors.ts) propagate.
 * A genuine backend failure still resolves to a `Response` here and is
 * untouched; only a *thrown* offline error is reclassified.
 */
async function fetchOrOffline(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (isOfflineNetworkError(error)) {
      throw new OfflineError(error);
    }
    throw error;
  }
}

/**
 * Performs an authenticated backend request and replays it once after a
 * successful token refresh. Keeping this helper independent from the identity
 * store prevents the identity bootstrap and API facade from importing each
 * other.
 */
export async function performAuthenticatedRequest(
  path: string,
  options: RequestInit = {},
  authSession: AuthSessionProvider,
): Promise<Response> {
  const url = withActiveLocale(path.startsWith('http') ? path : `${Config.apiBaseUrl}${path}`);

  const headers = new Headers(options.headers || {});
  const token = authSession.getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetchOrOffline(url, {
    ...options,
    headers,
  });

  if (response.status === 410 && authSession.onAccountDeleted) {
    try {
      const body = await response.clone().json();
      if (body && body.code === 'ACCOUNT_DELETED') {
        if (!accountDeletionTriggered) {
          accountDeletionTriggered = true;
          await authSession.onAccountDeleted();
        }
      }
    } catch {
      // ignore
    }
    return response;
  }

  if (response.status === 403) {
    try {
      const body = await response.clone().json();
      if (body && body.code === 'ACCOUNT_CLOSING') {
        throw new AccountClosingError(body.message || 'Account is closing');
      }
      if (
        body &&
        typeof body.message === 'string' &&
        /Registered Account required|Registered Account is required/.test(body.message)
      ) {
        await authSession.onAuthenticationRequired?.();
      }
    } catch (e) {
      if (e instanceof AccountClosingError) {
        throw e;
      }
    }
  }

  if (response.status !== 401) {
    return response;
  }

  try {
    const newToken = await authSession.refreshSession();
    const retryHeaders = new Headers(options.headers || {});
    retryHeaders.set('Authorization', `Bearer ${newToken}`);

    const retryResponse = await fetchOrOffline(url, {
      ...options,
      headers: retryHeaders,
    });

    if (retryResponse.status === 410 && authSession.onAccountDeleted) {
      try {
        const body = await retryResponse.clone().json();
        if (body && body.code === 'ACCOUNT_DELETED') {
          if (!accountDeletionTriggered) {
            accountDeletionTriggered = true;
            await authSession.onAccountDeleted();
          }
        }
      } catch {
        // ignore
      }
    }

    if (retryResponse.status === 403) {
      try {
        const body = await retryResponse.clone().json();
        if (body && body.code === 'ACCOUNT_CLOSING') {
          throw new AccountClosingError(body.message || 'Account is closing');
        }
        if (
          body &&
          typeof body.message === 'string' &&
          /Registered Account required|Registered Account is required/.test(body.message)
        ) {
          await authSession.onAuthenticationRequired?.();
        }
      } catch (e) {
        if (e instanceof AccountClosingError) {
          throw e;
        }
      }
    }

    return retryResponse;
  } catch (err) {
    if (err instanceof AccountClosingError || err instanceof OfflineError) {
      throw err;
    }
    return response;
  }
}
