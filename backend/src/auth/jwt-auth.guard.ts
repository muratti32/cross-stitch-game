import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';

import { ACCESS_TOKEN_VERSION } from './auth.constants';
import {
  AuthenticatedRequest,
  AuthPrincipal,
} from './auth.types';
import { PrincipalType } from './entities';

/**
 * Default guard for future player-authenticated API endpoints. Public bootstrap,
 * refresh, logout, and health routes intentionally opt out by not applying it.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request =
      context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);
    if (token === null) {
      throw this.authenticationRequired();
    }

    let payload: Record<string, unknown>;
    try {
      payload = await this.jwtService.verifyAsync<Record<string, unknown>>(
        token,
        { algorithms: ['HS256'] },
      );
    } catch {
      throw this.authenticationRequired();
    }

    const principal = this.readPrincipal(payload);
    if (principal === null) {
      throw this.authenticationRequired();
    }

    request.principal = principal;
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

  private readPrincipal(
    payload: Record<string, unknown>,
  ): AuthPrincipal | null {
    if (
      typeof payload.jti !== 'string' ||
      !isUUID(payload.jti) ||
      payload.principalType !== PrincipalType.Guest ||
      typeof payload.sub !== 'string' ||
      !isUUID(payload.sub) ||
      payload.tokenVersion !== ACCESS_TOKEN_VERSION
    ) {
      return null;
    }

    return {
      id: payload.sub,
      tokenVersion: payload.tokenVersion,
      type: payload.principalType,
    };
  }

  private authenticationRequired(): UnauthorizedException {
    return new UnauthorizedException('Authentication required');
  }
}
