import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';

import { ADMIN_JWT_AUDIENCE, ADMIN_JWT_ISSUER, ADMIN_PRINCIPAL_TYPE } from './admin.constants';
import { OperatorAccountEntity, OperatorRole } from './entities';
import { OperatorAccessTokenPayload, OperatorAuthenticatedRequest, OperatorPrincipal } from './operator-auth.types';

/**
 * Verifies an Operator Console access token. Structurally rejects any player
 * token: this guard's JwtService is registered with a distinct secret
 * (ADMIN_JWT_SECRET) so a token signed by the player JwtModule fails
 * signature verification outright, and even a same-secret forgery is still
 * rejected on issuer, audience, and principalType.
 */
@Injectable()
export class OperatorAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(OperatorAccountEntity)
    private readonly operatorAccounts: Repository<OperatorAccountEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request =
      context.switchToHttp().getRequest<OperatorAuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);
    if (token === null) {
      throw this.unauthorized();
    }

    let payload: Record<string, unknown>;
    try {
      payload = await this.jwtService.verifyAsync<Record<string, unknown>>(token, {
        algorithms: ['HS256'],
        audience: ADMIN_JWT_AUDIENCE,
        issuer: ADMIN_JWT_ISSUER,
      });
    } catch {
      throw this.unauthorized();
    }

    const claims = this.readClaims(payload);
    if (claims === null) {
      throw this.unauthorized();
    }

    const operator = await this.operatorAccounts.findOneBy({ id: claims.sub });
    if (operator === null || operator.disabled) {
      throw this.unauthorized();
    }

    const principal: OperatorPrincipal = { id: operator.id, role: operator.role };
    request.operatorPrincipal = principal;
    return true;
  }

  private extractBearerToken(
    authorization: string | readonly string[] | undefined,
  ): string | null {
    if (typeof authorization !== 'string') {
      return null;
    }
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    return match?.[1] ?? null;
  }

  private readClaims(
    payload: Record<string, unknown>,
  ): OperatorAccessTokenPayload | null {
    if (
      typeof payload.jti !== 'string' ||
      !isUUID(payload.jti) ||
      payload.principalType !== ADMIN_PRINCIPAL_TYPE ||
      typeof payload.sub !== 'string' ||
      !isUUID(payload.sub) ||
      !this.isKnownRole(payload.role)
    ) {
      return null;
    }
    return {
      jti: payload.jti,
      principalType: ADMIN_PRINCIPAL_TYPE,
      role: payload.role,
      sub: payload.sub,
    };
  }

  private isKnownRole(value: unknown): value is OperatorRole {
    return value === OperatorRole.Owner;
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException('Operator authentication required');
  }
}
