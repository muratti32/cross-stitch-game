import { Body, Controller, Get, Headers, Put, UseGuards } from '@nestjs/common';

import { AdminCatalogService } from './admin-catalog.service';
import { CurrentOperator } from './current-operator.decorator';
import { ReplaceStaffPicksDto } from './dto/replace-staff-picks.dto';
import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { OperatorPrincipal } from './operator-auth.types';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

@Controller('admin/staff-picks')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminStaffPicksController {
  constructor(private readonly adminCatalog: AdminCatalogService) {}

  @Get()
  @RequireOperatorPermissions('catalog.pattern.read')
  list() {
    return this.adminCatalog.getStaffPicks();
  }

  @Put()
  @RequireOperatorPermissions('catalog.staffpick.manage')
  replace(
    @CurrentOperator() operator: OperatorPrincipal,
    @Body() body: ReplaceStaffPicksDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminCatalog.replaceStaffPicks(
      operator.id,
      body.patternIds,
      requestId ?? null,
    );
  }
}
