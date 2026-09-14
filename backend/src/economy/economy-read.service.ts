import { HttpException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { CoinLedgerRepository, LedgerPrincipal } from './coin-ledger.repository';
import { CommerceLedgerRepository } from './commerce-ledger.repository';
import { DAILY_AD_LIMIT, DAILY_POOL_COIN } from './economy.constants';
import { readLocatorPrice } from './locator-price';
import { nextRewardDayResetAt, utcRewardDay } from './reward-day';

export interface CoinBalanceView {
  balance: number;
  /**
   * Current Locator Price for display and the locator's expected price
   * (ADR-0060); null when the setting is unavailable, so balance reads keep
   * working while locator reservations fail closed.
   */
  locatorPrice: number | null;
}

export interface RewardDayView {
  balance: number;
  /** Rewarded Ads that may still be rewarded today (0–3). */
  adsRemaining: number;
  /** Coin still available in today's Ad-Equivalent Coin Pool (0–30). */
  coinsRemaining: number;
  /** Premium claim closes the shared pool for the rest of this Reward Day. */
  premiumClaimed: boolean;
  /** ISO-8601 instant of the next 00:00 UTC Reward Day reset. */
  resetsAt: string;
}

/**
 * Read-only projections of a player's coin state for the client UI. Coin is
 * never mutated here; the authoritative grants live in {@link RewardGrantService}.
 */
@Injectable()
export class EconomyReadService {
  private readonly logger = new Logger(EconomyReadService.name);

  constructor(
    private readonly ledger: CoinLedgerRepository,
    private readonly commerceLedger: CommerceLedgerRepository,
    private readonly dataSource: DataSource,
  ) {}

  async getBalance(principal: AuthPrincipal): Promise<CoinBalanceView> {
    const [balance, locatorPrice] = await Promise.all([
      this.ledger.getBalance(toLedgerPrincipal(principal)),
      this.readDisplayLocatorPrice(),
    ]);
    return { balance, locatorPrice };
  }

  private async readDisplayLocatorPrice(): Promise<number | null> {
    try {
      return (await readLocatorPrice(this.dataSource.manager)).price;
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      this.logger.error('Locator Price setting is unavailable; balance served without it');
      return null;
    }
  }

  async getAiCreditBalance(principal: AuthPrincipal): Promise<{ balance: number }> {
    const ledgerPrincipal = toLedgerPrincipal(principal);
    const balance = await this.commerceLedger.getAiCreditBalance(ledgerPrincipal);
    return { balance };
  }

  async getRewardDay(principal: AuthPrincipal): Promise<RewardDayView> {
    const ledgerPrincipal = toLedgerPrincipal(principal);
    const [balance, status] = await Promise.all([
      this.ledger.getBalance(ledgerPrincipal),
      this.ledger.getRewardDayStatus(ledgerPrincipal, utcRewardDay()),
    ]);

    return {
      balance,
      adsRemaining: Math.max(0, DAILY_AD_LIMIT - status.adsCompleted),
      coinsRemaining: Math.max(0, DAILY_POOL_COIN - status.coinsConsumed),
      premiumClaimed: status.premiumClaimed,
      resetsAt: nextRewardDayResetAt().toISOString(),
    };
  }
}

function toLedgerPrincipal(principal: AuthPrincipal): LedgerPrincipal {
  return {
    type: principal.type === PrincipalType.Account ? 'account' : 'guest',
    id: principal.id,
  };
}
