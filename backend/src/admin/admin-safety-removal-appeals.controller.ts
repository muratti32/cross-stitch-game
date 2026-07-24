import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { SafetyRemovalAppealService } from '../catalog/safety-removal-appeal.service';
import { CurrentOperator } from './current-operator.decorator';
import { AcceptSafetyRemovalAppealDto } from './dto/accept-safety-removal-appeal.dto';
import { RejectSafetyRemovalAppealDto } from './dto/reject-safety-removal-appeal.dto';
import { OperatorAuthGuard } from './operator-auth.guard';
import type { OperatorPrincipal } from './operator-auth.types';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

@Controller('admin/safety-removal-appeals')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminSafetyRemovalAppealsController {
  constructor(private readonly appeals: SafetyRemovalAppealService) {}

  @Get()
  @RequireOperatorPermissions('catalog.post_publication_review.manage')
  list(@Query('status') status?: string) {
    return this.appeals.listForReview(status);
  }

  @Get(':id')
  @RequireOperatorPermissions('catalog.post_publication_review.manage')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.appeals.getForReview(id);
  }

  @Post(':id/accept')
  @RequireOperatorPermissions('catalog.post_publication_review.manage')
  accept(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptSafetyRemovalAppealDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.appeals.accept(operator.id, id, dto.reason, requestId ?? null);
  }

  @Post(':id/reject')
  @RequireOperatorPermissions('catalog.post_publication_review.manage')
  reject(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectSafetyRemovalAppealDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.appeals.reject(operator.id, id, dto.reason, requestId ?? null);
  }
}
