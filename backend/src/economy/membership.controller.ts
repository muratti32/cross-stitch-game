import { Controller, Get, Post, UseGuards } from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import { MembershipService, type MembershipView } from './membership.service';
import type { PremiumDailyClaimResult } from './membership.repository';

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
}
