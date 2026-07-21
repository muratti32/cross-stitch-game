import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import {
  CoinBalanceView,
  EconomyReadService,
  RewardDayView,
} from './economy-read.service';

/**
 * Read-only coin state for the authenticated player. The client can never
 * mutate coin here; earning happens only through the server-authoritative
 * grant paths (e.g. the AdMob SSV callback).
 */
@Controller('economy')
@UseGuards(JwtAuthGuard)
export class EconomyController {
  constructor(private readonly economyRead: EconomyReadService) {}

  @Get('balance')
  async getBalance(
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<CoinBalanceView> {
    return this.economyRead.getBalance(principal);
  }

  @Get('reward-day')
  async getRewardDay(
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<RewardDayView> {
    return this.economyRead.getRewardDay(principal);
  }
}
