import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { CatalogSubmissionService } from '../catalog/catalog-submission.service';
import {
  AcceptCatalogSubmissionDto,
  RejectCatalogSubmissionDto,
} from '../catalog/dto/catalog-review.dto';
import { CurrentOperator } from './current-operator.decorator';
import { OperatorAuthGuard } from './operator-auth.guard';
import type { OperatorPrincipal } from './operator-auth.types';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

@Controller('admin/catalog-submissions')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminCatalogSubmissionsController {
  constructor(private readonly submissions: CatalogSubmissionService) {}

  @Get()
  @RequireOperatorPermissions('catalog.submission.review')
  list(@Query('status') status?: string) {
    return this.submissions.listForReview(status);
  }

  @Get(':id')
  @RequireOperatorPermissions('catalog.submission.review')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.submissions.getForReview(id);
  }

  @Get(':id/preview')
  @RequireOperatorPermissions('catalog.submission.review')
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const bytes = await this.submissions.getReviewPreview(id);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Type', 'image/png');
    response.send(bytes);
  }

  @Post(':id/accept')
  @RequireOperatorPermissions('catalog.submission.review')
  accept(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptCatalogSubmissionDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.submissions.accept(operator.id, id, dto.note, requestId ?? null);
  }

  @Post(':id/reject')
  @RequireOperatorPermissions('catalog.submission.review')
  reject(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectCatalogSubmissionDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.submissions.reject(operator.id, id, dto.reason, dto.note, requestId ?? null);
  }
}
