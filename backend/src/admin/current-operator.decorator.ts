import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

import { OperatorAuthenticatedRequest, OperatorPrincipal } from './operator-auth.types';

export const CurrentOperator = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OperatorPrincipal => {
    const request =
      context.switchToHttp().getRequest<OperatorAuthenticatedRequest>();
    if (request.operatorPrincipal === undefined) {
      throw new UnauthorizedException('Operator authentication required');
    }
    return request.operatorPrincipal;
  },
);
