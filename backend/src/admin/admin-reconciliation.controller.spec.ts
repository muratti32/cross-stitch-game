import 'reflect-metadata';

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AdminReconciliationController } from './admin-reconciliation.controller';
import { OPERATOR_PERMISSIONS_KEY } from './require-operator-permissions.decorator';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { OPERATOR_ROLE_PERMISSIONS } from './operator-permission';
import { OperatorSecurityEventsService } from './operator-security-events.service';
import { OperatorRole } from './entities';
import type { OperatorPermission } from './operator-permission';

describe('AdminReconciliationController', () => {
  it('requires the explicit reconciliation read permission', () => {
    expect(
      Reflect.getMetadata(
        OPERATOR_PERMISSIONS_KEY,
        AdminReconciliationController.prototype.latest,
      ),
    ).toEqual(['reconciliation.read']);
  });

  it('rejects an authenticated operator without the reconciliation permission', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['reconciliation.read']),
    } as unknown as Reflector;
    const securityEvents = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as OperatorSecurityEventsService;
    const guard = new OperatorPermissionsGuard(reflector, securityEvents);
    const context = {
      getClass: () => AdminReconciliationController,
      getHandler: () => AdminReconciliationController.prototype.latest,
      switchToHttp: () => ({
        getRequest: () => ({
          operatorPrincipal: {
            id: '11111111-1111-4111-8111-111111111111',
            role: OperatorRole.Owner,
          },
        }),
      }),
    } as unknown as ExecutionContext;

    const ownerPermissions = OPERATOR_ROLE_PERMISSIONS[OperatorRole.Owner] as Set<OperatorPermission>;
    ownerPermissions.delete('reconciliation.read');
    try {
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
      expect(securityEvents.record).toHaveBeenCalled();
    } finally {
      ownerPermissions.add('reconciliation.read');
    }
  });
});
