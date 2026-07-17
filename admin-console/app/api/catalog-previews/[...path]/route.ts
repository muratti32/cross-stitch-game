import type { NextRequest, NextResponse } from 'next/server';

import { proxyPublicGet } from '@/lib/public-proxy';

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  return proxyPublicGet(request, '/v1/catalog-previews', path);
}
