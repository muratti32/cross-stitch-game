import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

import { CurrentPrincipal, JwtAuthGuard } from '../auth';
import type { AuthPrincipal } from '../auth/auth.types';
import {
  CoinBalanceView,
  EconomyReadService,
  RewardDayView,
} from './economy-read.service';
import { PatternUnlockService } from './pattern-unlock.service';
import { AdAttemptService } from './ad-attempt.service';
import type { AdAttemptStateView, OpenAdAttemptView } from './ad-attempt.types';
import {
  CommitLocatorAttemptInput,
  LocatorAttemptService,
  PrepareLocatorAttemptInput,
  ReleaseLocatorAttemptInput,
} from './locator-attempt.service';

class ClaimClientRewardDto {
  @IsUUID()
  nonce!: string;
}

class UnlockRequestDto {
  @IsUUID()
  patternId!: string;
}

class PrepareLocatorAttemptDto implements PrepareLocatorAttemptInput {
  @IsUUID()
  attemptId!: string;

  @IsUUID()
  sessionId!: string;

  @IsUUID()
  patternId!: string;

  @IsInt()
  @Min(0)
  colorIndex!: number;

  @IsString()
  @MaxLength(16)
  dmcCode!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  progressRevision?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  progressHash?: string;
}

class CommitLocatorAttemptDto implements CommitLocatorAttemptInput {
  @IsInt()
  @Min(0)
  targetCellIndex!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  progressRevision?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  progressHash?: string;
}

class ReleaseLocatorAttemptDto implements ReleaseLocatorAttemptInput {
  @IsOptional()
  @IsBoolean()
  cancellation?: boolean;
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
    private readonly locatorAttemptService: LocatorAttemptService,
  ) {}

  @Post('ad-attempts')
  async createAdAttempt(
    @CurrentPrincipal() principal: AuthPrincipal,
  ): Promise<OpenAdAttemptView> {
    return this.adAttemptService.openAttempt(principal);
  }

  @Get('ad-attempts/:nonce')
  async getAdAttempt(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('nonce', new ParseUUIDPipe({ version: '4' })) nonce: string,
  ): Promise<AdAttemptStateView> {
    return this.adAttemptService.getAttemptState(principal, nonce);
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

  @Post('locator-attempts/prepare')
  async prepareLocatorAttempt(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: PrepareLocatorAttemptDto,
  ) {
    return this.locatorAttemptService.prepare(principal, dto);
  }

  @Post('locator-attempts/:attemptId/commit')
  async commitLocatorAttempt(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('attemptId', new ParseUUIDPipe({ version: '4' })) attemptId: string,
    @Body() dto: CommitLocatorAttemptDto,
  ) {
    return this.locatorAttemptService.commit(principal, attemptId, dto);
  }

  @Post('locator-attempts/:attemptId/release')
  async releaseLocatorAttempt(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('attemptId', new ParseUUIDPipe({ version: '4' })) attemptId: string,
    @Body() dto: ReleaseLocatorAttemptDto,
  ) {
    return this.locatorAttemptService.release(principal, attemptId, dto);
  }

  @Get('locator-attempts/:attemptId')
  async getLocatorAttempt(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('attemptId', new ParseUUIDPipe({ version: '4' })) attemptId: string,
  ) {
    return this.locatorAttemptService.status(principal, attemptId);
  }

  @Get('unlocks')
  async unlocks(@CurrentPrincipal() p: AuthPrincipal) {
    return this.patternUnlock.listUnlocks(p);
  }
}
