import 'server-only';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { adminApiUrl } from './env';

/**
 * Forwards a GET request to a public (unauthenticated) backend route, such as
 * `/v1/catalog/*` or `/v1/catalog-previews/*`. No Authorization header is
 * attached — these routes carry no operator session. Still routed through the
 * Next.js server so the browser never learns ADMIN_API_URL.
 */
export async function proxyPublicGet(
  request: NextRequest,
  backendPrefix: string,
  pathSegments: string[],
): Promise<NextResponse> {
  const targetUrl = `${adminApiUrl()}${backendPrefix}/${pathSegments.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
  const upstream = await fetch(targetUrl, { cache: 'no-store' });

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
