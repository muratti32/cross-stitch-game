import { useQuery } from '@tanstack/react-query';
import { Config } from '../config';
import { HealthStatusResponse, isHealthStatusResponse } from '../types/api';

// The backend health endpoint returns HTTP 503 when degraded but still ships a
// valid body, so status codes alone cannot decide success — the body shape does.
export function useHealthCheck() {
  return useQuery<HealthStatusResponse>({
    queryKey: ['healthCheck'],
    queryFn: async () => {
      const response = await fetch(`${Config.apiBaseUrl}/v1/health`);
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        throw new Error(`Server returned status ${response.status} with no readable body`);
      }
      if (isHealthStatusResponse(body)) {
        return body;
      }
      throw new Error(`Server returned status ${response.status} with an unexpected body shape`);
    },
  });
}
