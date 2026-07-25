import { Controller, Get, UseGuards } from '@nestjs/common';

import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { ReconciliationAdminService } from './reconciliation-admin.service';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

@Controller('admin/reconciliation')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminReconciliationController {
  constructor(private readonly reconciliation: ReconciliationAdminService) {}

  @Get()
  @RequireOperatorPermissions('reconciliation.read')
  latest() {
    return this.reconciliation.latest();
  }
}
