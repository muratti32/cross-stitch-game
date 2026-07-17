import 'server-only';

import { cookies } from 'next/headers';

import {
  ACCESS_TOKEN_COOKIE,
  OPERATOR_PROFILE_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from './cookie-names';
import { accessTokenTtlSeconds, refreshTokenTtlSeconds } from './env';
import type { OperatorProfile } from './types';

const isProduction = process.env.NODE_ENV === 'production';

const baseCookieOptions = {
  httpOnly: true,
  path: '/',
  sameSite: 'strict' as const,
  secure: isProduction,
};

// Tokens and the operator profile are stored exclusively in httpOnly cookies
// scoped to the console origin; they never reach browser JavaScript (ADR-0039,
// CONTEXT.md "Operator Console"). Route Handlers are the only code that reads
// or writes them.

export async function setTokens(accessToken: string, refreshToken: string): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_TOKEN_COOKIE, accessToken, {
    ...baseCookieOptions,
    maxAge: accessTokenTtlSeconds(),
  });
  store.set(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...baseCookieOptions,
    maxAge: refreshTokenTtlSeconds(),
  });
}

export async function setOperatorProfile(profile: OperatorProfile): Promise<void> {
  const store = await cookies();
  store.set(OPERATOR_PROFILE_COOKIE, JSON.stringify(profile), {
    ...baseCookieOptions,
    maxAge: refreshTokenTtlSeconds(),
  });
}

export async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_TOKEN_COOKIE)?.value ?? null;
}

export async function getOperatorProfile(): Promise<OperatorProfile | null> {
  const store = await cookies();
  const raw = store.get(OPERATOR_PROFILE_COOKIE)?.value;
  if (raw === undefined) {
    return null;
  }
  try {
    return JSON.parse(raw) as OperatorProfile;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_TOKEN_COOKIE);
  store.delete(REFRESH_TOKEN_COOKIE);
  store.delete(OPERATOR_PROFILE_COOKIE);
}
