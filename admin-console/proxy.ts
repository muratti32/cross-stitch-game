import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { REFRESH_TOKEN_COOKIE } from '@/lib/cookie-names';

// Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`; behavior is
// unchanged. This performs only an optimistic redirect based on cookie
// presence (per the Next.js authentication guide) — the real authorization
// check happens against the backend on every Route Handler call.
const LOGIN_PATH = '/login';

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.get(REFRESH_TOKEN_COOKIE) !== undefined;
  const isLoginPath = pathname === LOGIN_PATH;

  if (!hasSession && !isLoginPath) {
    const loginUrl = new URL(LOGIN_PATH, request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (hasSession && isLoginPath) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
