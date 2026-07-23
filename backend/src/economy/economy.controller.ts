import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import {
  CoinBalanceView,
  EconomyReadService,
  RewardDayView,
} from './economy-read.service';
import { PatternUnlockService } from './pattern-unlock.service';

class UnlockRequestDto {
  @IsUUID()
  patternId!: string;
}

/**
 * Read-only coin state for the authenticated player. The client can never
 * mutate coin here; earning happens only through the server-authoritative
 * grant paths (e.g. the AdMob SSV callback).
 */
@Controller('economy')
@UseGuards(JwtAuthGuard)
export class EconomyController {
  constructor(
    private readonly economyRead: EconomyReadService,
    private readonly patternUnlock: PatternUnlockService,
  ) {}

  @Get('balance')
  async getBalance(
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<CoinBalanceView> {
    return this.economyRead.getBalance(principal);
  }

  @Get('ai-credit-balance')
  async getAiCreditBalance(
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<{ balance: number }> {
    return this.economyRead.getAiCreditBalance(principal);
  }

  @Get('reward-day')
  async getRewardDay(
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<RewardDayView> {
    return this.economyRead.getRewardDay(principal);
  }

  @Post('unlocks')
  async unlock(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body() dto: UnlockRequestDto,
  ) {
    return this.patternUnlock.unlock(p, dto.patternId);
  }

  @Get('unlocks')
  async unlocks(@CurrentPrincipal() p: AuthPrincipal) {
    return this.patternUnlock.listUnlocks(p);
  }
}
