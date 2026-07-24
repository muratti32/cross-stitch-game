import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';

import { ProfileReportService } from '../creator-profile/profile-report.service';
import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

@Controller('admin/profile-investigations')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminProfileInvestigationsController {
  constructor(private readonly reports: ProfileReportService) {}

  @Get()
  @RequireOperatorPermissions('moderation.profile_investigation.review')
  list(@Query('status') status?: string) {
    return this.reports.listInvestigations(status);
  }

  @Get(':id')
  @RequireOperatorPermissions('moderation.profile_investigation.review')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.getInvestigation(id);
  }
}
