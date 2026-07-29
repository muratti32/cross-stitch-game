import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { CoinPackReconciliationDto } from './coin-pack-reconciliation.dto';
import {
  CoinPackReconciliationService,
  type CoinPackReconciliationStatus,
} from './coin-pack-reconciliation.service';

@Controller('commerce/coin-packs/reconciliations')
@UseGuards(JwtAuthGuard)
export class CoinPackReconciliationController {
  constructor(private readonly reconciliations: CoinPackReconciliationService) {}

  @Post()
  start(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: CoinPackReconciliationDto,
  ): Promise<{ id: string; supportReference: string }> {
    return this.reconciliations.start(principal, body);
  }

  @Get(':id')
  getStatus(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CoinPackReconciliationStatus> {
    return this.reconciliations.getStatus(principal, id);
  }
}
