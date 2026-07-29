import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { AiCreditPackReconciliationDto } from './ai-credit-pack-reconciliation.dto';
import {
  AiCreditPackReconciliationService,
  type AiCreditPackReconciliationStatus,
} from './ai-credit-pack-reconciliation.service';

@Controller('commerce/ai-credit-packs/reconciliations')
@UseGuards(JwtAuthGuard)
export class AiCreditPackReconciliationController {
  constructor(private readonly reconciliations: AiCreditPackReconciliationService) {}

  @Post()
  start(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: AiCreditPackReconciliationDto,
  ): Promise<{ id: string; supportReference: string }> {
    return this.reconciliations.start(principal, body);
  }

  @Get(':id')
  getStatus(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AiCreditPackReconciliationStatus> {
    return this.reconciliations.getStatus(principal, id);
  }
}
