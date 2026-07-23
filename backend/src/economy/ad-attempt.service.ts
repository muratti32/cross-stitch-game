import { ConflictException, Injectable } from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { AppConfigService } from '../config/app-config.service';
import { AdAttemptRepository } from './ad-attempt.repository';
import { CoinLedgerRepository, LedgerPrincipal } from './coin-ledger.repository';
import {
  AD_PLACEMENT_REWARDED,
  AD_REWARD_COIN,
  DAILY_AD_LIMIT,
  DAILY_POOL_COIN,
} from './economy.constants';
import { utcRewardDay } from './reward-day';

@Injectable()
export class AdAttemptService {
  constructor(
    private readonly adAttempts: AdAttemptRepository,
    private readonly ledger: CoinLedgerRepository,
    private readonly config: AppConfigService,
  ) {}

  async openAttempt(
    principal: AuthPrincipal,
  ): Promise<{ nonce: string; expiresAt: string }> {
    const ledgerPrincipal = toLedgerPrincipal(principal);
    const status = await this.ledger.getRewardDayStatus(
      ledgerPrincipal,
      utcRewardDay(),
    );

    if (
      status.premiumClaimed ||
      DAILY_AD_LIMIT - status.adsCompleted <= 0 ||
      DAILY_POOL_COIN - status.coinsConsumed < AD_REWARD_COIN
    ) {
      throw new ConflictException(
        'Ad-Equivalent Coin Pool is exhausted for this Reward Day',
      );
    }

    const { nonce, expiresAt } = await this.adAttempts.create(
      ledgerPrincipal,
      AD_PLACEMENT_REWARDED,
      this.config.adAttemptTtlSeconds,
    );

    return {
      nonce,
      expiresAt: expiresAt.toISOString(),
    };
  }
}

function toLedgerPrincipal(principal: AuthPrincipal): LedgerPrincipal {
  return {
    type: principal.type === PrincipalType.Account ? 'account' : 'guest',
    id: principal.id,
  };
}
