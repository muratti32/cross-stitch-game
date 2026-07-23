import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { CoinLedgerRepository } from './coin-ledger.repository';
import {
  MembershipRepository,
  PremiumMembershipRequiredError,
  type MembershipStatus,
  type PremiumDailyClaimResult,
} from './membership.repository';
import { nextRewardDayResetAt, utcRewardDay } from './reward-day';
import { DAILY_POOL_COIN } from './economy.constants';

export interface MembershipView extends MembershipStatus {
  dailyClaim: {
    claimed: boolean;
    coinsAvailable: number;
    resetsAt: string;
  };
}

@Injectable()
export class MembershipService {
  constructor(
    private readonly membership: MembershipRepository,
    private readonly coinLedger: CoinLedgerRepository,
  ) {}

  async getStatus(principal: AuthPrincipal): Promise<MembershipView> {
    if (principal.type !== PrincipalType.Account) return this.guestView();
    const rewardDay = utcRewardDay();
    const [status, pool] = await Promise.all([
      this.membership.getStatus(principal.id),
      this.coinLedger.getRewardDayStatus(
        { type: 'account', id: principal.id },
        rewardDay,
      ),
    ]);
    return {
      ...status,
      dailyClaim: {
        claimed: pool.premiumClaimed,
        coinsAvailable:
          status.active && !pool.premiumClaimed
            ? Math.max(0, DAILY_POOL_COIN - pool.coinsConsumed)
            : 0,
        resetsAt: nextRewardDayResetAt().toISOString(),
      },
    };
  }

  async claimDaily(principal: AuthPrincipal): Promise<PremiumDailyClaimResult> {
    if (principal.type !== PrincipalType.Account) {
      throw new ForbiddenException('A Registered Account is required for Premium Membership');
    }
    try {
      return await this.membership.claimPremiumDailyCoin(principal.id, utcRewardDay());
    } catch (error) {
      if (error instanceof PremiumMembershipRequiredError) {
        throw new ForbiddenException('An active Premium Membership is required');
      }
      if (error instanceof Error && error.message === 'premium_membership_required') {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private guestView(): MembershipView {
    return {
      active: false,
      plan: null,
      lifecycle: null,
      expiresAt: null,
      themeAccess: false,
      dailyClaim: {
        claimed: false,
        coinsAvailable: 0,
        resetsAt: nextRewardDayResetAt().toISOString(),
      },
    };
  }
}
