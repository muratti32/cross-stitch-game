import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import {
  AdMobSsvReward,
  AdMobSsvVerifierService,
} from './admob-ssv-verifier.service';
import {
  AdRewardGrantResult,
  CoinLedgerRepository,
  LedgerPrincipal,
} from './coin-ledger.repository';
import { AdAttemptRepository } from './ad-attempt.repository';
import { utcRewardDay } from './reward-day';

export interface AdRewardCallbackResult extends AdRewardGrantResult {
  transactionId: string;
}

/**
 * Turns a verified AdMob SSV callback into an idempotent Stitch Coin grant
 * (ADR-0033). A client-reported completion never reaches this path — only the
 * signed server callback does.
 */
@Injectable()
export class RewardGrantService {
  private readonly logger = new Logger(RewardGrantService.name);

  constructor(
    private readonly verifier: AdMobSsvVerifierService,
    private readonly ledger: CoinLedgerRepository,
    private readonly config: AppConfigService,
    private readonly adAttempts: AdAttemptRepository,
  ) {}

  async processAdCallback(rawQuery: string): Promise<AdRewardCallbackResult> {
    const reward = await this.verifier.verify(rawQuery);
    this.assertKnownAdUnit(reward);

    if (reward.transactionId.length === 0) {
      throw new BadRequestException('SSV callback is missing a transaction id');
    }

    const sourceKey = `ad:${reward.transactionId}`;
    const existing = await this.ledger.findExistingAdGrant(sourceKey);
    if (existing !== null) {
      return this.replayResult(existing, reward.transactionId);
    }

    const principal = await this.adAttempts.consume(reward.customData);
    if (principal === null) {
      const existingAfterConsume = await this.ledger.findExistingAdGrant(sourceKey);
      if (existingAfterConsume !== null) {
        return this.replayResult(existingAfterConsume, reward.transactionId);
      }
      throw new BadRequestException(
        'SSV callback nonce is invalid, expired, or already used',
      );
    }

    const rewardDay = utcRewardDay();

    const result = await this.ledger.grantAdReward(
      principal,
      rewardDay,
      sourceKey,
    );

    this.logger.log(
      `AdMob SSV ${reward.transactionId}: granted=${result.granted} amount=${result.amount} replayed=${result.replayed}`,
    );

    return { ...result, transactionId: reward.transactionId };
  }

  private async replayResult(
    existing: {
      principal: LedgerPrincipal;
      granted: boolean;
      amount: number;
    },
    transactionId: string,
  ): Promise<AdRewardCallbackResult> {
    const [balance, status] = await Promise.all([
      this.ledger.getBalance(existing.principal),
      this.ledger.getRewardDayStatus(existing.principal, utcRewardDay()),
    ]);
    const result: AdRewardCallbackResult = {
      granted: existing.granted,
      amount: existing.amount,
      balance,
      adsCompleted: status.adsCompleted,
      coinsConsumed: status.coinsConsumed,
      replayed: true,
      transactionId,
    };
    this.logger.log(
      `AdMob SSV ${transactionId}: granted=${result.granted} amount=${result.amount} replayed=${result.replayed}`,
    );
    return result;
  }

  private assertKnownAdUnit(reward: AdMobSsvReward): void {
    const allowed = this.config.admobSsvAllowedAdUnits;
    if (allowed.length > 0 && !allowed.includes(reward.adUnit)) {
      throw new BadRequestException(
        'SSV callback references an unexpected ad unit',
      );
    }
  }
}
