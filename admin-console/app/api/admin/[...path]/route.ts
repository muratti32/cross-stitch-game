import type { NextRequest, NextResponse } from 'next/server';

import { proxyAdminRequest } from '@/lib/admin-proxy';

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  return proxyAdminRequest(request, path);
}

export { handle as DELETE, handle as GET, handle as POST, handle as PUT };
