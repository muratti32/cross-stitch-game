import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';

import {
  AcceptCreatorRestrictionAppealDto,
  UpholdCreatorRestrictionAppealDto,
} from '../creator-profile/dto/decide-profile-appeal.dto';
import { ProfileReportService } from '../creator-profile/profile-report.service';
import { CurrentOperator } from './current-operator.decorator';
import { OperatorAuthGuard } from './operator-auth.guard';
import type { OperatorPrincipal } from './operator-auth.types';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

@Controller('admin/creator-restriction-appeals')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminCreatorRestrictionAppealsController {
  constructor(private readonly reports: ProfileReportService) {}

  @Get()
  @RequireOperatorPermissions('moderation.profile_investigation.review')
  list(@Query('status') status?: string) {
    return this.reports.listAppeals(status);
  }

  @Get(':id')
  @RequireOperatorPermissions('moderation.profile_investigation.review')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.getAppeal(id);
  }

  @Post(':id/accept')
  @RequireOperatorPermissions('moderation.profile_investigation.review')
  accept(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptCreatorRestrictionAppealDto,
  ) {
    return this.reports.acceptAppeal(operator.id, id, dto.reason);
  }

  @Post(':id/uphold')
  @RequireOperatorPermissions('moderation.profile_investigation.review')
  uphold(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpholdCreatorRestrictionAppealDto,
  ) {
    return this.reports.upholdAppeal(operator.id, id, dto.reason);
  }
}
