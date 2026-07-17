import { NextResponse } from 'next/server';

import { adminApiUrl } from '@/lib/env';

export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).email !== 'string' ||
    typeof (body as Record<string, unknown>).password !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Bad Request', message: 'email and password are required', statusCode: 400 },
      { status: 400 },
    );
  }
  const { email, password } = body as { email: string; password: string };

  const upstream = await fetch(`${adminApiUrl()}/v1/admin/auth/login`, {
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const payload: unknown = await upstream.json().catch(() => null);
  return NextResponse.json(payload, { status: upstream.status });
}
