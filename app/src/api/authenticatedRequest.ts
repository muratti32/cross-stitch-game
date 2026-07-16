import { Config } from '../config';

export interface AuthSessionProvider {
  getAccessToken: () => string | null;
  refreshSession: () => Promise<string>;
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

  if (response.status !== 401) {
    return response;
  }

  try {
    const newToken = await authSession.refreshSession();
    const retryHeaders = new Headers(options.headers || {});
    retryHeaders.set('Authorization', `Bearer ${newToken}`);

    return await fetch(url, {
      ...options,
      headers: retryHeaders,
    });
  } catch {
    return response;
  }
}
