import 'server-only';

/**
 * Base URL of the backend NestJS API (e.g. http://localhost:3000). Server-only:
 * the Operator Console browser bundle never sees this value or any operator
 * token — every backend call is proxied through a Next.js Route Handler.
 */
export function adminApiUrl(): string {
  const url = process.env.ADMIN_API_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('ADMIN_API_URL is not configured. Set it in .env.local.');
  }
  return url.replace(/\/+$/, '');
}

export function accessTokenTtlSeconds(): number {
  return parsePositiveInt(process.env.ADMIN_ACCESS_TOKEN_TTL_SECONDS, 900);
}

export function refreshTokenTtlSeconds(): number {
  return parsePositiveInt(process.env.ADMIN_REFRESH_TOKEN_TTL_SECONDS, 43_200);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
