import { NextResponse } from 'next/server';

import { adminApiUrl } from '@/lib/env';
import { setOperatorProfile, setTokens } from '@/lib/session';
import type { OperatorProfile } from '@/lib/types';

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).challenge !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Bad Request', message: 'challenge is required', statusCode: 400 },
      { status: 400 },
    );
  }
  const { challenge, totpCode, recoveryCode } = body as {
    challenge: string;
    totpCode?: unknown;
    recoveryCode?: unknown;
  };

  const upstream = await fetch(`${adminApiUrl()}/v1/admin/auth/mfa`, {
    body: JSON.stringify({
      challenge,
      recoveryCode: typeof recoveryCode === 'string' ? recoveryCode : undefined,
      totpCode: typeof totpCode === 'string' ? totpCode : undefined,
    }),
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const payload: unknown = await upstream.json().catch(() => null);

  if (!upstream.ok || payload === null) {
    return NextResponse.json(
      payload ?? { error: 'Unauthorized', message: 'MFA verification failed', statusCode: upstream.status },
      { status: upstream.status },
    );
  }

  const session = payload as { accessToken: string; refreshToken: string; operator: OperatorProfile };
  await setTokens(session.accessToken, session.refreshToken);
  await setOperatorProfile(session.operator);

  return NextResponse.json({ operator: session.operator }, { status: 200 });
}
