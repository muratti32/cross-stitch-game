import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

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
import { SupportReferenceService } from '../support/support-reference.service';
import type { PremiumReconciliationDto } from './premium-reconciliation.dto';
import { returningRows } from '../database/query-results';

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
    private readonly dataSource: DataSource,
    private readonly supportReferences: SupportReferenceService,
  ) {}

  async getStatus(principal: AuthPrincipal): Promise<MembershipView> {
    const rewardDay = utcRewardDay();
    const owner = principal.type === PrincipalType.Account
      ? { type: 'account' as const, accountId: principal.id }
      : { type: 'guest' as const, guestInstallationId: principal.id };
    const [status, pool] = await Promise.all([
      this.membership.getStatus(owner),
      this.coinLedger.getRewardDayStatus(
        { type: owner.type, id: principal.id },
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
    try {
      const owner = principal.type === PrincipalType.Account
        ? { type: 'account' as const, accountId: principal.id }
        : { type: 'guest' as const, guestInstallationId: principal.id };
      return await this.membership.claimPremiumDailyCoin(owner, utcRewardDay());
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

  async startReconciliation(
    principal: AuthPrincipal,
    input: PremiumReconciliationDto,
  ): Promise<{ supportReference: string }> {
    const premiumKeys = new Set(['premium_weekly', 'premium_monthly', 'premium_annual']);
    if (
      (input.operation === 'purchase' && !premiumKeys.has(input.productKey ?? ''))
      || (input.operation === 'restore' && input.productKey !== null)
    ) {
      throw new BadRequestException('Invalid Premium reconciliation request');
    }
    return this.dataSource.transaction(async (manager) => {
      const result: unknown = await manager.query(
        `INSERT INTO economy.premium_purchase_reconciliations
           (account_id, guest_installation_id, operation, product_key)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [principal.type === PrincipalType.Account ? principal.id : null,
          principal.type === PrincipalType.Guest ? principal.id : null,
          input.operation, input.productKey],
      );
      const reconciliation = returningRows<{ id: string }>(result)[0];
      if (reconciliation === undefined) {
        throw new Error('Premium reconciliation record was not created');
      }
      const supportReference = await this.supportReferences.create(manager, {
        principalType: principal.type === PrincipalType.Account ? 'account' : 'guest',
        principalId: principal.id,
        records: [{ type: 'premium_purchase_reconciliation', id: reconciliation.id }],
      });
      return { supportReference };
    });
  }

}
