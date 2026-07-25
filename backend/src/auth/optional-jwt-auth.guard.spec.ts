import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ACCESS_TOKEN_VERSION } from './auth.constants';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';
import { AuthenticatedRequest } from './auth.types';
import { PrincipalType } from './entities';

const GUEST_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const JTI = '33333333-3333-4333-8333-333333333333';

function contextForToken(token: string | undefined): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const request = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function guardWithPayload(
  payload: Record<string, unknown> | Error,
): OptionalJwtAuthGuard {
  const jwtService = {
    verifyAsync: jest.fn(() =>
      payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload),
    ),
  } as unknown as JwtService;
  return new OptionalJwtAuthGuard(jwtService);
}

describe('OptionalJwtAuthGuard', () => {
  it('admits a valid Guest principal', async () => {
    const guard = guardWithPayload({
      jti: JTI,
      principalType: PrincipalType.Guest,
      sub: GUEST_ID,
      tokenVersion: ACCESS_TOKEN_VERSION,
    });
    const { context, request } = contextForToken('token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.principal).toEqual({
      id: GUEST_ID,
      tokenVersion: ACCESS_TOKEN_VERSION,
      type: PrincipalType.Guest,
    });
  });

  it('admits a valid Account principal', async () => {
    const guard = guardWithPayload({
      jti: JTI,
      principalType: PrincipalType.Account,
      sub: ACCOUNT_ID,
      tokenVersion: ACCESS_TOKEN_VERSION,
    });
    const { context, request } = contextForToken('token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.principal).toEqual({
      id: ACCOUNT_ID,
      tokenVersion: ACCESS_TOKEN_VERSION,
      type: PrincipalType.Account,
    });
  });

  it('allows missing Authorization header by leaving principal undefined', async () => {
    const guard = guardWithPayload({});
    const { context, request } = contextForToken(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.principal).toBeUndefined();
  });

  it('allows token that fails verification by leaving principal undefined', async () => {
    const guard = guardWithPayload(new Error('bad signature'));
    const { context, request } = contextForToken('token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.principal).toBeUndefined();
  });

  it('allows unknown principal type by leaving principal undefined', async () => {
    const guard = guardWithPayload({
      jti: JTI,
      principalType: 'operator',
      sub: ACCOUNT_ID,
      tokenVersion: ACCESS_TOKEN_VERSION,
    });
    const { context, request } = contextForToken('token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.principal).toBeUndefined();
  });

  it('allows stale token version by leaving principal undefined', async () => {
    const guard = guardWithPayload({
      jti: JTI,
      principalType: PrincipalType.Account,
      sub: ACCOUNT_ID,
      tokenVersion: ACCESS_TOKEN_VERSION + 1,
    });
    const { context, request } = contextForToken('token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.principal).toBeUndefined();
  });
});
