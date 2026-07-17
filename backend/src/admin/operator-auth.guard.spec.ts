import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';

import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorAccountEntity, OperatorRole } from './entities';
import { OperatorAuthenticatedRequest } from './operator-auth.types';

const OPERATOR_ID = '22222222-2222-4222-8222-222222222222';
const JTI = '33333333-3333-4333-8333-333333333333';

function contextForToken(token: string | undefined): {
  context: ExecutionContext;
  request: OperatorAuthenticatedRequest;
} {
  const request: OperatorAuthenticatedRequest = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function guardWith(
  payload: Record<string, unknown> | Error,
  operator: OperatorAccountEntity | null = {
    disabled: false,
    id: OPERATOR_ID,
    role: OperatorRole.Owner,
  } as OperatorAccountEntity,
): OperatorAuthGuard {
  const jwtService = {
    verifyAsync: jest.fn(() =>
      payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload),
    ),
  } as unknown as JwtService;
  const operatorAccounts = {
    findOneBy: jest.fn().mockResolvedValue(operator),
  } as unknown as Repository<OperatorAccountEntity>;
  return new OperatorAuthGuard(jwtService, operatorAccounts);
}

describe('OperatorAuthGuard', () => {
  it('admits a valid operator principal and attaches it to the request', async () => {
    const guard = guardWith({
      jti: JTI,
      principalType: 'operator',
      role: OperatorRole.Owner,
      sub: OPERATOR_ID,
    });
    const { context, request } = contextForToken('token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.operatorPrincipal).toEqual({
      id: OPERATOR_ID,
      role: OperatorRole.Owner,
    });
  });

  it('rejects when the Authorization header is missing', async () => {
    const guard = guardWith({});
    const { context } = contextForToken(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a player-style token: verification fails because it was signed with a different secret/issuer/audience', async () => {
    // This is exactly what happens to a real player access token: it was
    // signed by the player JwtModule (JWT_SECRET, no issuer/audience), so
    // verifying it against ADMIN_JWT_SECRET + issuer/audience throws here.
    const guard = guardWith(new Error('invalid signature'));
    const { context } = contextForToken('player-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a payload whose principalType is not "operator" (defense in depth)', async () => {
    const guard = guardWith({
      jti: JTI,
      principalType: 'account',
      role: OperatorRole.Owner,
      sub: OPERATOR_ID,
    });
    const { context } = contextForToken('token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an unknown role', async () => {
    const guard = guardWith({
      jti: JTI,
      principalType: 'operator',
      role: 'superadmin',
      sub: OPERATOR_ID,
    });
    const { context } = contextForToken('token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when the operator account no longer exists', async () => {
    const guard = guardWith(
      { jti: JTI, principalType: 'operator', role: OperatorRole.Owner, sub: OPERATOR_ID },
      null,
    );
    const { context } = contextForToken('token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a disabled operator account', async () => {
    const guard = guardWith(
      { jti: JTI, principalType: 'operator', role: OperatorRole.Owner, sub: OPERATOR_ID },
      { disabled: true, id: OPERATOR_ID, role: OperatorRole.Owner } as OperatorAccountEntity,
    );
    const { context } = contextForToken('token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
