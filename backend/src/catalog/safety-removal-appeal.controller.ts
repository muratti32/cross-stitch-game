import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { CreateSafetyRemovalAppealDto } from './dto/create-safety-removal-appeal.dto';
import { SafetyRemovalAppealService } from './safety-removal-appeal.service';

@Controller('catalog/patterns')
@UseGuards(JwtAuthGuard)
export class SafetyRemovalAppealController {
  constructor(private readonly appeals: SafetyRemovalAppealService) {}

  @Post(':patternId/safety-removal-appeal')
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('patternId', ParseUUIDPipe) patternId: string,
    @Body() dto: CreateSafetyRemovalAppealDto,
  ) {
    return this.appeals.create(principal, patternId, dto);
  }

  @Get(':patternId/safety-removal-appeal')
  getMine(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('patternId', ParseUUIDPipe) patternId: string,
  ) {
    return this.appeals.getMine(principal, patternId);
  }
}
