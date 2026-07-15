import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { ACCESS_TOKEN_VERSION } from './auth.constants';
import { JwtAuthGuard } from './jwt-auth.guard';
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
): JwtAuthGuard {
  const jwtService = {
    verifyAsync: jest.fn(async () => {
      if (payload instanceof Error) {
        throw payload;
      }
      return payload;
    }),
  } as unknown as JwtService;
  return new JwtAuthGuard(jwtService);
}

describe('JwtAuthGuard', () => {
  it('admits a Guest principal', async () => {
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

  it('admits an Account principal (registered account sessions)', async () => {
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

  it('rejects an unknown principal type', async () => {
    const guard = guardWithPayload({
      jti: JTI,
      principalType: 'operator',
      sub: ACCOUNT_ID,
      tokenVersion: ACCESS_TOKEN_VERSION,
    });
    const { context } = contextForToken('token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a stale token version', async () => {
    const guard = guardWithPayload({
      jti: JTI,
      principalType: PrincipalType.Account,
      sub: ACCOUNT_ID,
      tokenVersion: ACCESS_TOKEN_VERSION + 1,
    });
    const { context } = contextForToken('token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a missing Authorization header', async () => {
    const guard = guardWithPayload({});
    const { context } = contextForToken(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token that fails verification', async () => {
    const guard = guardWithPayload(new Error('bad signature'));
    const { context } = contextForToken('token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
