import { AdminApiError } from './admin-client.js';

/** Text result block for a successful tool call. */
export function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** Error result block, unwrapping AdminApiError into the backend's status and body. */
export function fail(error: unknown) {
  if (error instanceof AdminApiError) {
    return {
      content: [
        { type: 'text' as const, text: `Admin API error ${error.status}: ${JSON.stringify(error.body)}` },
      ],
      isError: true,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

/** Builds a `?a=1&b=2` query string, dropping undefined and empty values. */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
