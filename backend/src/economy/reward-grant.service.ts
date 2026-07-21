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
import { utcRewardDay } from './reward-day';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  ) {}

  async processAdCallback(rawQuery: string): Promise<AdRewardCallbackResult> {
    const reward = await this.verifier.verify(rawQuery);
    this.assertKnownAdUnit(reward);

    if (reward.transactionId.length === 0) {
      throw new BadRequestException('SSV callback is missing a transaction id');
    }

    const principal = this.resolvePrincipal(reward.customData);
    const rewardDay = utcRewardDay();
    const sourceKey = `ad:${reward.transactionId}`;

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

  private assertKnownAdUnit(reward: AdMobSsvReward): void {
    const allowed = this.config.admobSsvAllowedAdUnits;
    if (allowed.length > 0 && !allowed.includes(reward.adUnit)) {
      throw new BadRequestException(
        'SSV callback references an unexpected ad unit',
      );
    }
  }

  private resolvePrincipal(customData: string): LedgerPrincipal {
    // customData carries only the opaque backend player identity as `type:id`
    // (ADR-0033) — never email, provider ids, or other personal data.
    const separator = customData.indexOf(':');
    const type = separator < 0 ? '' : customData.slice(0, separator);
    const id = separator < 0 ? '' : customData.slice(separator + 1);

    if ((type !== 'guest' && type !== 'account') || !UUID_PATTERN.test(id)) {
      throw new BadRequestException('SSV callback custom data is invalid');
    }

    return { type, id };
  }
}
