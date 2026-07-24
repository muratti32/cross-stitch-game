import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';

import {
  CloseProfileInvestigationDto,
  RemediateProfileInvestigationDto,
  ResetProfileUsernameDto,
} from '../creator-profile/dto/decide-profile-investigation.dto';
import { ProfileReportService } from '../creator-profile/profile-report.service';
import { CurrentOperator } from './current-operator.decorator';
import { OperatorAuthGuard } from './operator-auth.guard';
import type { OperatorPrincipal } from './operator-auth.types';
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

  @Post(':id/close')
  @RequireOperatorPermissions('moderation.profile_investigation.review')
  close(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseProfileInvestigationDto,
  ) {
    return this.reports.close(operator.id, id, dto.reason);
  }

  @Post(':id/remediate')
  @RequireOperatorPermissions('moderation.profile_investigation.review')
  remediate(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemediateProfileInvestigationDto,
  ) {
    return this.reports.remediate(operator.id, id, dto.reason);
  }

  @Post(':id/reset-username')
  @RequireOperatorPermissions('moderation.profile_investigation.review')
  resetUsername(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetProfileUsernameDto,
  ) {
    return this.reports.resetUsername(operator.id, id, dto.reason);
  }
}
