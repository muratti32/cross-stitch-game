import { Config } from '../config';

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
  const url = path.startsWith('http') ? path : `${Config.apiBaseUrl}${path}`;

  const headers = new Headers(options.headers || {});
  const token = authSession.getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, {
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

    const retryResponse = await fetch(url, {
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
    if (err instanceof AccountClosingError) {
      throw err;
    }
    return response;
  }
}
