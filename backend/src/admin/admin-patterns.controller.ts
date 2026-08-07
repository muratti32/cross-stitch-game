import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { PatternStatus } from '../catalog/entities';
import { AdminCatalogService } from './admin-catalog.service';
import { BulkRemovePatternsDto } from './dto/bulk-remove-patterns.dto';
import { CurrentOperator } from './current-operator.decorator';
import { UpdatePatternMetadataDto } from './dto/update-pattern-metadata.dto';
import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { OperatorPrincipal } from './operator-auth.types';
import { RequireOperatorPermissions } from './require-operator-permissions.decorator';

const KNOWN_STATUSES: readonly PatternStatus[] = [
  'available',
  'review_hold',
  'withdrawn',
  'removed',
];

@Controller('admin/patterns')
@UseGuards(OperatorAuthGuard, OperatorPermissionsGuard)
export class AdminPatternsController {
  constructor(private readonly adminCatalog: AdminCatalogService) {}

  @Get()
  @RequireOperatorPermissions('catalog.pattern.read')
  list(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const parsedStatus = this.parseStatus(status);
    return this.adminCatalog.listPatterns({
      page: parsePositiveInt(page, 1),
      pageSize: Math.min(parsePositiveInt(pageSize, 20), 100),
      search,
      status: parsedStatus,
    });
  }

  @Get(':id')
  @RequireOperatorPermissions('catalog.pattern.read')
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminCatalog.getPatternById(id);
  }

  @Put(':id/metadata')
  @RequireOperatorPermissions('catalog.pattern.manage')
  updateMetadata(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePatternMetadataDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminCatalog.updateMetadata(
      operator.id,
      id,
      body,
      requestId ?? null,
    );
  }

  @Post(':id/withdraw')
  @RequireOperatorPermissions('catalog.pattern.manage')
  withdraw(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminCatalog.withdrawPattern(operator.id, id, requestId ?? null);
  }

  @Post('bulk-remove')
  @RequireOperatorPermissions('catalog.pattern.manage')
  bulkRemove(
    @CurrentOperator() operator: OperatorPrincipal,
    @Body() body: BulkRemovePatternsDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminCatalog.bulkRemovePatterns(
      operator.id,
      body.patternIds,
      body.reason,
      body.batchId,
      requestId ?? null,
    );
  }

  @Post(':id/remove')
  @RequireOperatorPermissions('catalog.pattern.manage')
  remove(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminCatalog.removePattern(operator.id, id, requestId ?? null);
  }

  @Post(':id/restore')
  @RequireOperatorPermissions('catalog.pattern.manage')
  restore(
    @CurrentOperator() operator: OperatorPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.adminCatalog.restorePattern(operator.id, id, requestId ?? null);
  }

  private parseStatus(status: string | undefined): PatternStatus | undefined {
    if (status === undefined || status === '') {
      return undefined;
    }
    if (!KNOWN_STATUSES.includes(status as PatternStatus)) {
      throw new BadRequestException(`Invalid status filter: ${status}`);
    }
    return status as PatternStatus;
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException(`Invalid numeric parameter: ${value}`);
  }
  return parsed;
}
