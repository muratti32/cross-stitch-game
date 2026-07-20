import { Body, Controller, Get, Headers, Param, Post, Put, UseGuards } from '@nestjs/common';

import { AdminCatalogService } from './admin-catalog.service';
import { CurrentOperator } from './current-operator.decorator';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryLabelDto } from './dto/update-category-label.dto';
import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { OperatorPrincipal } from './operator-auth.types';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

@Controller('admin/categories')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminCategoriesController {
  constructor(private readonly adminCatalog: AdminCatalogService) {}

  @Get()
  @RequireOperatorPermissions('catalog.pattern.read')
  list() {
    return this.adminCatalog.listCategories();
  }

  @Post()
  @RequireOperatorPermissions('catalog.category.manage')
  create(
    @CurrentOperator() operator: OperatorPrincipal,
    @Body() body: CreateCategoryDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminCatalog.createCategory(operator.id, body.code, body.label, requestId ?? null);
  }

  @Put(':code/label')
  @RequireOperatorPermissions('catalog.category.manage')
  updateLabel(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('code') code: string,
    @Body() body: UpdateCategoryLabelDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminCatalog.updateCategoryLabel(operator.id, code, body.label, requestId ?? null);
  }

  @Post(':code/deactivate')
  @RequireOperatorPermissions('catalog.category.manage')
  deactivate(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('code') code: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminCatalog.deactivateCategory(operator.id, code, requestId ?? null);
  }
}
