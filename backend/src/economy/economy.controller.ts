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
import { AdAttemptService } from './ad-attempt.service';

class ClaimClientRewardDto {
  @IsUUID()
  nonce!: string;
}

class UnlockRequestDto {
  @IsUUID()
  patternId!: string;
}

/**
 * Read-only coin state for the authenticated player. The client can never
 * mutate coin here; earning happens only through the server-authoritative
 * grant paths (e.g. the AdMob SSV callback or client claim endpoint when SSV is disabled).
 */
@Controller('economy')
@UseGuards(JwtAuthGuard)
export class EconomyController {
  constructor(
    private readonly economyRead: EconomyReadService,
    private readonly patternUnlock: PatternUnlockService,
    private readonly adAttemptService: AdAttemptService,
  ) {}

  @Post('ad-attempts')
  async createAdAttempt(
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<{ nonce: string; expiresAt: string }> {
    return this.adAttemptService.openAttempt(principal);
  }

  @Post('ad-attempts/claim')
  async claimClientReward(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: ClaimClientRewardDto,
  ) {
    return this.adAttemptService.claimClientReward(principal, dto.nonce);
  }

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
