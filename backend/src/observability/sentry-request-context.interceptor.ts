import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';

import type { AuthenticatedRequest } from '../auth/auth.types';

function getSentryIsolationScope(): {
  setTag(key: string, value: string): void;
  setUser(user: { id: string }): void;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/nestjs');
    return Sentry.getIsolationScope?.() ?? null;
  } catch {
    return null;
  }
}

@Injectable()
export class SentryRequestContextInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest & {
      route?: { path?: unknown };
    }>();
    const scope = getSentryIsolationScope();
    if (!scope) {
      return next.handle();
    }

    const routePath = request.route?.path;
    if (typeof routePath === 'string') {
      scope.setTag('route', routePath);
    }
    scope.setTag(
      'handler',
      `${context.getClass().name}.${context.getHandler().name}`,
    );
    if (request.principal !== undefined) {
      // AuthPrincipal.id is the Guest Installation or Registered Account UUID
      // used by Support Reference records. No provider identifier is present.
      scope.setUser({ id: request.principal.id });
    }

    return next.handle();
  }
}
