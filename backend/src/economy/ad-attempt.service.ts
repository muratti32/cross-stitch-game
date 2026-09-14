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
  ): Promise<{ nonce: string; expiresAt: string; ssvActive: boolean }> {
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
      ssvActive: this.config.enableAdmobSsv,
    };
  }

  async claimClientReward(
    principal: AuthPrincipal,
    nonce: string,
  ): Promise<AdRewardGrantResult> {
    const ledgerPrincipal = toLedgerPrincipal(principal);

    if (this.config.enableAdmobSsv) {
      // Under SSV, rewards are granted authoritatively by the AdMob server callback (ADR-0033).
      // We do not consume the nonce here because the SSV verifier callback must consume it.
      // If a client calls claim anyway (e.g. legacy app versions), return current balance and
      // status idempotently without throwing 400 so the UI updates smoothly and no Sentry
      // errors are generated.
      const [balance, status] = await Promise.all([
        this.ledger.getBalance(ledgerPrincipal),
        this.ledger.getRewardDayStatus(ledgerPrincipal, utcRewardDay()),
      ]);
      return {
        granted: false,
        amount: 0,
        balance,
        adsCompleted: status.adsCompleted,
        coinsConsumed: status.coinsConsumed,
        replayed: false,
      };
    }
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
