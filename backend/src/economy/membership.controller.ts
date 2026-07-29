import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { MembershipService, type MembershipView } from './membership.service';
import type { PremiumDailyClaimResult } from './membership.repository';
import { PremiumReconciliationDto } from './premium-reconciliation.dto';

@Controller('commerce/membership')
@UseGuards(JwtAuthGuard)
export class MembershipController {
  constructor(private readonly membership: MembershipService) {}

  @Get()
  getStatus(@CurrentPrincipal() principal: AuthPrincipal): Promise<MembershipView> {
    return this.membership.getStatus(principal);
  }

  @Post('daily-claim')
  claimDaily(
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<PremiumDailyClaimResult> {
    return this.membership.claimDaily(principal);
  }

  @Post('reconciliations')
  startReconciliation(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() body: PremiumReconciliationDto,
  ): Promise<{ supportReference: string }> {
    return this.membership.startReconciliation(principal, body);
  }
}
