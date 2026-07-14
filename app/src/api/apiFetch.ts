import { Config } from '../config';
import { getAccessToken, refreshSession } from '../identity/guestIdentity';

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
  // Ensure the path has the correct API base URL prefix
  const url = path.startsWith('http') ? path : `${Config.apiBaseUrl}${path}`;

  // Clone headers and attach access token if it exists in memory
  const headers = new Headers(options.headers || {});
  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const mergedOptions = {
    ...options,
    headers,
  };

  const response = await fetch(url, mergedOptions);

  if (response.status === 401) {
    try {
      // Refresh the session (single-flight)
      const newToken = await refreshSession();

      // Replay the request once with the new token
      const retryHeaders = new Headers(options.headers || {});
      retryHeaders.set('Authorization', `Bearer ${newToken}`);
      
      return await fetch(url, {
        ...options,
        headers: retryHeaders,
      });
    } catch (refreshErr) {
      // If refresh fails, return the original 401 response
      return response;
    }
  }

  return response;
}
