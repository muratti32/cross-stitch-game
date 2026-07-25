import 'reflect-metadata';

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AdminOperationalAlertsController } from './admin-operational-alerts.controller';
import { OPERATOR_PERMISSIONS_KEY } from './require-operator-permissions.decorator';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { OPERATOR_ROLE_PERMISSIONS } from './operator-permission';
import { OperatorSecurityEventsService } from './operator-security-events.service';
import { OperatorRole } from './entities';
import type { OperatorPermission } from './operator-permission';

describe('AdminOperationalAlertsController', () => {
  it('requires the explicit operational alerts read permission', () => {
    expect(
      Reflect.getMetadata(
        OPERATOR_PERMISSIONS_KEY,
        AdminOperationalAlertsController.prototype.latest,
      ),
    ).toEqual(['operational_alerts.read']);
  });

  it('rejects an authenticated operator without the operational alerts permission', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['operational_alerts.read']),
    } as unknown as Reflector;
    const securityEvents = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as OperatorSecurityEventsService;
    const guard = new OperatorPermissionsGuard(reflector, securityEvents);
    const context = {
      getClass: () => AdminOperationalAlertsController,
      getHandler: () => AdminOperationalAlertsController.prototype.latest,
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
    ownerPermissions.delete('operational_alerts.read');
    try {
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
      expect(securityEvents.record).toHaveBeenCalled();
    } finally {
      ownerPermissions.add('operational_alerts.read');
    }
  });
});
