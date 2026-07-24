import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';

import { CatalogMetadataRevisionService } from '../catalog/catalog-metadata-revision.service';
import {
  AcceptCatalogMetadataRevisionDto,
  RejectCatalogMetadataRevisionDto,
} from '../catalog/dto/catalog-metadata-review.dto';
import { CurrentOperator } from './current-operator.decorator';
import { OperatorAuthGuard } from './operator-auth.guard';
import type { OperatorPrincipal } from './operator-auth.types';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

@Controller('admin/catalog-metadata-revisions')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminCatalogMetadataRevisionsController {
  constructor(private readonly revisions: CatalogMetadataRevisionService) {}

  @Get()
  @RequireOperatorPermissions('catalog.metadata_revision.review')
  list(@Query('status') status?: string) {
    return this.revisions.listForReview(status);
  }

  @Get(':id')
  @RequireOperatorPermissions('catalog.metadata_revision.review')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.revisions.getForReview(id);
  }

  @Post(':id/accept')
  @RequireOperatorPermissions('catalog.metadata_revision.review')
  accept(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptCatalogMetadataRevisionDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.revisions.accept(operator.id, id, dto.note, requestId ?? null);
  }

  @Post(':id/reject')
  @RequireOperatorPermissions('catalog.metadata_revision.review')
  reject(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectCatalogMetadataRevisionDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.revisions.reject(operator.id, id, dto.reason, dto.note, requestId ?? null);
  }
}
