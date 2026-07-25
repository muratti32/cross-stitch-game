import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  GoneException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

import type { AuthenticatedRequest } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { AccountStateService } from './account-state.service';

interface RequestWithPrincipal extends AuthenticatedRequest {
  method?: string;
  path?: string;
  originalUrl?: string;
}

@Injectable()
export class AccountWriteFreezeInterceptor implements NestInterceptor {
  constructor(private readonly accountStateService: AccountStateService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    if (!request) {
      return next.handle();
    }

    const principal = request.principal;
    if (!principal || principal.type !== PrincipalType.Account) {
      return next.handle();
    }

    const status = await this.accountStateService.getAccountStatus(principal.id);
    if (status === 'deleted') {
      throw new GoneException({
        code: 'ACCOUNT_DELETED',
        message: 'Account has been deleted',
      });
    }

    const method = request.method?.toUpperCase() ?? '';
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }

    const path = request.path ?? '';
    const originalUrl = request.originalUrl ?? '';
    const urlPath = (path || originalUrl).split('?')[0] ?? '';

    const allowedPrefixes = [
      '/v1/account/deletion',
      '/v1/auth/refresh',
      '/v1/auth/logout',
      '/v1/support',
    ];

    const isAllowlisted = allowedPrefixes.some((prefix) =>
      urlPath.startsWith(prefix),
    );

    if (isAllowlisted) {
      return next.handle();
    }

    if (status === 'closing') {
      throw new ForbiddenException({
        code: 'ACCOUNT_CLOSING',
        message: 'Account is pending deletion',
      });
    }

    return next.handle();
  }
}
