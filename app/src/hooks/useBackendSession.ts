import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api';

export interface SessionResponse {
  id: string;
  type: 'guest';
  tokenVersion: number;
}

/**
 * Fetch and monitor the current backend session using the authenticated client.
 */
export function useBackendSession() {
  return useQuery<SessionResponse>({
    queryKey: ['backendSession'],
    queryFn: async () => {
      const response = await apiFetch('/v1/auth/session');
      if (response.status === 200) {
        return await response.json();
      }
      if (response.status === 401) {
        throw new Error('Unauthorized (401)');
      }
      throw new Error(`Session error: status ${response.status}`);
    },
    retry: false, // Do not retry continuously if unauthorized
  });
}
