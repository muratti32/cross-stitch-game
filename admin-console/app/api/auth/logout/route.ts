import { NextResponse } from 'next/server';

import { adminApiUrl } from '@/lib/env';
import { clearSession, getRefreshToken } from '@/lib/session';

export async function POST(): Promise<NextResponse> {
  const refreshToken = await getRefreshToken();
  if (refreshToken !== null) {
    await fetch(`${adminApiUrl()}/v1/admin/auth/logout`, {
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }).catch(() => undefined);
  }
  await clearSession();
  return new NextResponse(null, { status: 204 });
}
