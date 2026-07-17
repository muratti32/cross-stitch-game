import { Body, Controller, Get, Headers, Param, Post, Put, UseGuards } from '@nestjs/common';

import { AdminCatalogService } from './admin-catalog.service';
import { CurrentOperator } from './current-operator.decorator';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagLabelsDto } from './dto/update-tag-labels.dto';
import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { OperatorPrincipal } from './operator-auth.types';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

@Controller('admin/tags')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminTagsController {
  constructor(private readonly adminCatalog: AdminCatalogService) {}

  @Get()
  @RequireOperatorPermissions('catalog.pattern.read')
  list() {
    return this.adminCatalog.listTags();
  }

  @Post()
  @RequireOperatorPermissions('catalog.tag.manage')
  create(
    @CurrentOperator() operator: OperatorPrincipal,
    @Body() body: CreateTagDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminCatalog.createTag(operator.id, body.code, body.labels, requestId ?? null);
  }

  @Put(':code/labels')
  @RequireOperatorPermissions('catalog.tag.manage')
  updateLabels(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('code') code: string,
    @Body() body: UpdateTagLabelsDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminCatalog.updateTagLabels(operator.id, code, body.labels, requestId ?? null);
  }

  @Post(':code/deactivate')
  @RequireOperatorPermissions('catalog.tag.manage')
  deactivate(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('code') code: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminCatalog.deactivateTag(operator.id, code, requestId ?? null);
  }
}
