import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { permissionsForRole } from './operator-permission';
import { OPERATOR_PERMISSIONS_KEY } from './require-operator-permissions.decorator';
import { OperatorSecurityEventsService } from './operator-security-events.service';
import { OperatorAuthenticatedRequest } from './operator-auth.types';
import { OperatorPermission } from './operator-permission';

/**
 * Runs after OperatorAuthGuard. Reads @RequireOperatorPermissions metadata
 * and checks it against the authenticated operator's role -> permission
 * mapping, recording an `authorization_denied` security event on mismatch.
 */
@Injectable()
export class OperatorPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly securityEvents: OperatorSecurityEventsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<OperatorPermission[]>(
      OPERATOR_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required === undefined || required.length === 0) {
      return true;
    }

    const request =
      context.switchToHttp().getRequest<OperatorAuthenticatedRequest>();
    const principal = request.operatorPrincipal;
    if (principal === undefined) {
      throw new ForbiddenException('Operator authentication required');
    }

    const granted = permissionsForRole(principal.role);
    const missing = required.filter((permission) => !granted.has(permission));
    if (missing.length > 0) {
      await this.securityEvents.record({
        detail: { missing, path: this.describeRoute(context), required },
        eventType: 'authorization_denied',
        operatorAccountId: principal.id,
      });
      throw new ForbiddenException('Insufficient operator permissions');
    }
    return true;
  }

  private describeRoute(context: ExecutionContext): string {
    return `${context.getClass().name}.${context.getHandler().name}`;
  }
}
