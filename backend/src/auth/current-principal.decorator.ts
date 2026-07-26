import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

import {
  AuthenticatedRequest,
  AuthPrincipal,
} from './auth.types';

export function getCurrentPrincipal(_data: unknown, context: ExecutionContext): AuthPrincipal {
  const request =
    context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (request.principal === undefined) {
    throw new UnauthorizedException('Authentication required');
  }
  return request.principal;
}

export function getOptionalPrincipal(_data: unknown, context: ExecutionContext): AuthPrincipal | undefined {
  const request =
    context.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.principal;
}

/**
 * Decorator to retrieve the current authenticated principal.
 * Must be used in conjunction with JwtAuthGuard.
 */
export const CurrentPrincipal = createParamDecorator(getCurrentPrincipal);

/**
 * Decorator to retrieve the principal, if present, or undefined if the caller is anonymous.
 * Must be used in conjunction with OptionalJwtAuthGuard.
 */
export const OptionalPrincipal = createParamDecorator(getOptionalPrincipal);

