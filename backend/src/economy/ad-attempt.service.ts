import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { AppConfigService } from '../config/app-config.service';
import { AdAttemptRepository } from './ad-attempt.repository';
import {
  AdRewardGrantResult,
  CoinLedgerRepository,
  LedgerPrincipal,
} from './coin-ledger.repository';
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

  async claimClientReward(
    principal: AuthPrincipal,
    nonce: string,
  ): Promise<AdRewardGrantResult> {
    if (this.config.enableAdmobSsv) {
      throw new BadRequestException(
        'Client ad reward claim is disabled when AdMob SSV is active',
      );
    }

    const ledgerPrincipal = toLedgerPrincipal(principal);
    const sourceKey = `ad_client:${nonce}`;

    const existing = await this.ledger.findExistingAdGrant(sourceKey);
    if (existing !== null) {
      const balance = await this.ledger.getBalance(existing.principal);
      const status = await this.ledger.getRewardDayStatus(
        existing.principal,
        utcRewardDay(),
      );
      return {
        granted: existing.granted,
        amount: existing.amount,
        balance,
        adsCompleted: status.adsCompleted,
        coinsConsumed: status.coinsConsumed,
        replayed: true,
      };
    }

    const consumedPrincipal = await this.adAttempts.consume(nonce);
    if (consumedPrincipal === null) {
      const existingAfter = await this.ledger.findExistingAdGrant(sourceKey);
      if (existingAfter !== null) {
        const balance = await this.ledger.getBalance(existingAfter.principal);
        const status = await this.ledger.getRewardDayStatus(
          existingAfter.principal,
          utcRewardDay(),
        );
        return {
          granted: existingAfter.granted,
          amount: existingAfter.amount,
          balance,
          adsCompleted: status.adsCompleted,
          coinsConsumed: status.coinsConsumed,
          replayed: true,
        };
      }
      throw new BadRequestException(
        'Ad attempt nonce is invalid, expired, or already used',
      );
    }

    if (
      consumedPrincipal.type !== ledgerPrincipal.type ||
      consumedPrincipal.id !== ledgerPrincipal.id
    ) {
      throw new BadRequestException('Ad attempt nonce belongs to a different user');
    }

    const rewardDay = utcRewardDay();
    return this.ledger.grantAdReward(ledgerPrincipal, rewardDay, sourceKey);
  }
}

function toLedgerPrincipal(principal: AuthPrincipal): LedgerPrincipal {
  return {
    type: principal.type === PrincipalType.Account ? 'account' : 'guest',
    id: principal.id,
  };
}
