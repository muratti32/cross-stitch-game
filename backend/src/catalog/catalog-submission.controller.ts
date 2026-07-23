import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { CatalogSubmissionService } from './catalog-submission.service';
import { CreateCatalogAppealDto } from './dto/create-catalog-appeal.dto';
import { CreateCatalogSubmissionDto } from './dto/create-catalog-submission.dto';

@Controller('catalog-submissions')
@UseGuards(JwtAuthGuard)
export class CatalogSubmissionController {
  constructor(private readonly submissions: CatalogSubmissionService) {}

  @Post('patterns/:patternId')
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Body() dto: CreateCatalogSubmissionDto,
  ) {
    return this.submissions.create(principal, patternId, dto);
  }

  @Get('me')
  listMine(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.submissions.listMine(principal);
  }

  @Get(':id')
  getMine(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.submissions.getMine(principal, id);
  }

  @Post(':id/appeal')
  appeal(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCatalogAppealDto,
  ) {
    return this.submissions.createAppeal(principal, id, dto);
  }
}
