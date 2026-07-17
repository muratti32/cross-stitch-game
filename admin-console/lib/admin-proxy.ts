import 'server-only';

import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { adminApiUrl } from './env';
import { clearSession, getAccessToken, getRefreshToken, setTokens } from './session';

type FetchInit = RequestInit & { duplex?: 'half' };

const FORWARDED_REQUEST_HEADERS = ['content-type'];

// Guards against the backend's refresh-token rotation/reuse-detection
// (operator-auth.service.ts): if two requests hit this proxy concurrently
// with an expired access token, only one should actually rotate the refresh
// token. The rest await the same in-flight attempt and reuse its result.
let inFlightRefresh: Promise<boolean> | null = null;

/**
 * Forwards a request to `${ADMIN_API_URL}/v1/admin/<pathSegments>`, attaching
 * the operator's access token from the httpOnly session cookie. Retries once
 * after a token refresh on a 401, then gives up and clears the session.
 */
export async function proxyAdminRequest(
  request: NextRequest,
  pathSegments: string[],
): Promise<NextResponse> {
  const initialAccessToken = await getAccessToken();
  if (initialAccessToken === null && (await getRefreshToken()) === null) {
    return unauthorizedResponse();
  }

  let upstream = await forward(request, pathSegments, initialAccessToken);
  if (upstream.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      await clearSession();
      return unauthorizedResponse();
    }
    upstream = await forward(request, pathSegments, await getAccessToken());
  }
  return relay(upstream);
}

async function forward(
  request: NextRequest,
  pathSegments: string[],
  accessToken: string | null,
): Promise<Response> {
  const targetUrl = `${adminApiUrl()}/v1/admin/${pathSegments.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  headers.set('x-request-id', request.headers.get('x-request-id') ?? randomUUID());
  if (accessToken !== null) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body !== null;
  const init: FetchInit = {
    body: hasBody ? request.body : undefined,
    cache: 'no-store',
    headers,
    method: request.method,
  };
  if (hasBody) {
    init.duplex = 'half';
  }
  return fetch(targetUrl, init);
}

async function refreshSession(): Promise<boolean> {
  if (inFlightRefresh !== null) {
    return inFlightRefresh;
  }
  inFlightRefresh = performRefresh();
  try {
    return await inFlightRefresh;
  } finally {
    inFlightRefresh = null;
  }
}

async function performRefresh(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (refreshToken === null) {
    return false;
  }
  const response = await fetch(`${adminApiUrl()}/v1/admin/auth/refresh`, {
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    return false;
  }
  const data = (await response.json()) as { accessToken: string; refreshToken: string };
  await setTokens(data.accessToken, data.refreshToken);
  return true;
}

function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Unauthorized', message: 'Operator session expired', statusCode: 401 },
    { status: 401 },
  );
}

async function relay(upstream: Response): Promise<NextResponse> {
  const headers = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType !== null) {
    headers.set('content-type', contentType);
  }
  const cacheControl = upstream.headers.get('cache-control');
  if (cacheControl !== null) {
    headers.set('cache-control', cacheControl);
  }
  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  return new NextResponse(body, { headers, status: upstream.status });
}
