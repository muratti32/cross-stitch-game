import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { CatalogMetadataRevisionService } from './catalog-metadata-revision.service';
import { CreateCatalogMetadataAppealDto } from './dto/create-catalog-metadata-appeal.dto';
import { CreateCatalogMetadataRevisionDto } from './dto/create-catalog-metadata-revision.dto';

@Controller('catalog-metadata-revisions')
@UseGuards(JwtAuthGuard)
export class CatalogMetadataRevisionController {
  constructor(private readonly revisions: CatalogMetadataRevisionService) {}

  @Get('patterns/mine')
  myPatterns(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.revisions.myPatterns(principal);
  }

  @Post('patterns/:patternId')
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Body() dto: CreateCatalogMetadataRevisionDto,
  ) {
    return this.revisions.create(principal, patternId, dto);
  }

  @Get('me')
  listMine(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.revisions.listMine(principal);
  }

  @Get(':id')
  getMine(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.revisions.getMine(principal, id);
  }

  @Post(':id/withdraw')
  withdraw(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.revisions.withdraw(principal, id);
  }

  @Post(':id/appeal')
  appeal(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCatalogMetadataAppealDto,
  ) {
    return this.revisions.appeal(principal, id, dto);
  }
}
