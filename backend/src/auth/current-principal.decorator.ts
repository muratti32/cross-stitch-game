import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

import {
  AuthenticatedRequest,
  AuthPrincipal,
} from './auth.types';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const request =
      context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.principal === undefined) {
      throw new UnauthorizedException('Authentication required');
    }
    return request.principal;
  },
);
