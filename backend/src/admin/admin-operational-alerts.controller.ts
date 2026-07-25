import { Controller, Get, UseGuards } from '@nestjs/common';

import { OperationalAlertsAdminService } from './operational-alerts-admin.service';
import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

@Controller('admin/operational-alerts')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminOperationalAlertsController {
  constructor(private readonly operationalAlerts: OperationalAlertsAdminService) {}

  @Get()
  @RequireOperatorPermissions('operational_alerts.read')
  latest() {
    return this.operationalAlerts.latest();
  }
}
