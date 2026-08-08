import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { returningRows } from '../database/query-results';
import { DAILY_POOL_COIN } from './economy.constants';
import { AiCreditLedgerReason, CoinLedgerReason } from './entities';
import {
  periodHasEntitlement,
  projectMembershipPeriod,
  selectMembershipPeriod,
  type MembershipLifecycle,
  type MembershipPeriodProjection,
  type VerifiedMembershipEvent,
} from './membership-projection';
import type { PremiumPlan } from './membership.constants';
import { premiumDailyClaimAmount } from './membership.constants';

interface MembershipEventRow {
  environment: 'sandbox' | 'production';
  provider_event_id: string;
  provider_transaction_id: string;
  original_transaction_id: string;
  account_id: string;
  event_type: string;
  product_id: string;
  period_type: string;
  event_at: Date | string;
  purchased_at: Date | string;
  expires_at: Date | string | null;
  grace_period_expires_at: Date | string | null;
  cancel_reason: string | null;
}

interface MembershipPeriodRow {
  plan: PremiumPlan;
  current_status: MembershipLifecycle;
  ends_at: Date | string | null;
  status_event_at: Date | string;
}

interface BalanceRow {
  balance: string;
}

interface CoinClaimRow {
  id: string;
  amount: string;
}

interface PoolRow {
  coins_consumed: number;
  ads_completed: number;
  premium_claimed: boolean;
}

export interface MembershipEventResult {
  recorded: boolean;
  rejectedOtherAccount: boolean;
  creditGranted: number;
  creditReversed: number;
}

export interface MembershipTransferInput {
  environment: 'sandbox' | 'production';
  fromAccountIds: readonly string[];
  toAccountId: string;
}

export interface MembershipTransferResult {
  eventsMoved: number;
  periodsMoved: number;
}

export interface MembershipStatus {
  active: boolean;
  plan: PremiumPlan | null;
  lifecycle: MembershipLifecycle | null;
  expiresAt: string | null;
  themeAccess: boolean;
}

export interface PremiumDailyClaimResult {
  claimed: boolean;
  amount: number;
  balance: number;
  coinsConsumed: number;
  replayed: boolean;
}

export class PremiumMembershipRequiredError extends Error {
  constructor() {
    super('premium_membership_required');
  }
}

@Injectable()
export class MembershipRepository {
  constructor(private readonly dataSource: DataSource) {}

  async recordVerifiedEvent(
    event: VerifiedMembershipEvent,
  ): Promise<MembershipEventResult> {
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      // Serialize ownership claims for one provider transaction even when two
      // different RevenueCat event ids race on separate webhook deliveries.
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `${event.environment}:${event.providerTransactionId}`,
      ]);
      const ownerRows = await manager.query<readonly { account_id: string }[]>(
        `SELECT account_id
         FROM economy.membership_events
         WHERE environment = $1 AND provider_transaction_id = $2
         LIMIT 1`,
        [event.environment, event.providerTransactionId],
      );
      if (ownerRows[0] && ownerRows[0].account_id !== event.accountId) {
        return {
          recorded: false,
          rejectedOtherAccount: true,
          creditGranted: 0,
          creditReversed: 0,
        };
      }

      const inserted = returningRows<{ provider_event_id: string }>(
        await manager.query(
          `INSERT INTO economy.membership_events
             (environment, provider_event_id, provider_transaction_id,
              original_transaction_id, account_id, event_type, product_id,
              period_type, event_at, purchased_at, expires_at,
              grace_period_expires_at, cancel_reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT ON CONSTRAINT "PK_membership_events" DO NOTHING
           RETURNING provider_event_id`,
          [
            event.environment,
            event.providerEventId,
            event.providerTransactionId,
            event.originalTransactionId,
            event.accountId,
            event.type,
            event.productId,
            event.periodType,
            event.eventAt,
            event.purchasedAt,
            event.expiresAt,
            event.gracePeriodExpiresAt,
            event.cancelReason,
          ],
        ),
      );

      const historyRows = await manager.query<readonly MembershipEventRow[]>(
        `SELECT *
         FROM economy.membership_events
         WHERE environment = $1 AND provider_transaction_id = $2
         ORDER BY event_at ASC, provider_event_id ASC`,
        [event.environment, event.providerTransactionId],
      );
      const history = historyRows.map(toVerifiedEvent);
      const projection = projectMembershipPeriod(history);
      if (projection === null) {
        return {
          recorded: inserted.length > 0,
          rejectedOtherAccount: false,
          creditGranted: 0,
          creditReversed: 0,
        };
      }

      await this.upsertPeriod(manager, event, projection);
      const creditGranted = await this.applyCreditGrant(
        manager,
        event.environment,
        event.providerTransactionId,
        projection,
      );
      const creditReversed = projection.refunded
        ? await this.applyCreditReversal(
            manager,
            event.environment,
            event.providerTransactionId,
            projection,
          )
        : 0;

      return {
        recorded: inserted.length > 0,
        rejectedOtherAccount: false,
        creditGranted,
        creditReversed,
      };
    });
  }

  /**
   * Moves every Membership Event and Membership Period recorded for the
   * previous subscriber identities onto the account RevenueCat transferred the
   * store subscription to. Ownership is re-anchored rather than duplicated, so
   * the ownership guard in recordVerifiedEvent keeps rejecting genuine
   * cross-account claims while a real transfer stops looking like one.
   */
  async transferMembership(input: MembershipTransferInput): Promise<MembershipTransferResult> {
    if (input.fromAccountIds.length === 0) {
      return { eventsMoved: 0, periodsMoved: 0 };
    }
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const transactionRows = await manager.query<
        readonly { provider_transaction_id: string }[]
      >(
        `SELECT DISTINCT provider_transaction_id
         FROM economy.membership_events
         WHERE environment = $1 AND account_id = ANY($2::uuid[])
         ORDER BY provider_transaction_id`,
        [input.environment, [...input.fromAccountIds]],
      );
      // Take the same per-transaction locks recordVerifiedEvent takes, in a
      // stable order, so a transfer and an in-flight event for one of these
      // transactions cannot interleave (or deadlock) mid-rebind.
      for (const row of transactionRows) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${input.environment}:${row.provider_transaction_id}`,
        ]);
      }

      const movedEvents = await manager.query<readonly { provider_event_id: string }[]>(
        `UPDATE economy.membership_events
         SET account_id = $3
         WHERE environment = $1 AND account_id = ANY($2::uuid[])
         RETURNING provider_event_id`,
        [input.environment, [...input.fromAccountIds], input.toAccountId],
      );
      const movedPeriods = await manager.query<
        readonly { provider_transaction_id: string }[]
      >(
        `UPDATE economy.membership_periods
         SET account_id = $3, updated_at = now()
         WHERE environment = $1 AND account_id = ANY($2::uuid[])
         RETURNING provider_transaction_id`,
        [input.environment, [...input.fromAccountIds], input.toAccountId],
      );

      return {
        eventsMoved: movedEvents.length,
        periodsMoved: movedPeriods.length,
      };
    });
  }

  async getStatus(accountId: string, now: Date = new Date()): Promise<MembershipStatus> {
    return this.getStatusWithManager(this.dataSource.manager, accountId, now);
  }

  async claimPremiumDailyCoin(
    accountId: string,
    rewardDay: string,
    now: Date = new Date(),
  ): Promise<PremiumDailyClaimResult> {
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const sourceKey = `premium_daily:${accountId}:${rewardDay}`;
      const existing = await manager.query<readonly { amount: string }[]>(
        `SELECT amount
         FROM economy.coin_ledger_entries
         WHERE source_key = $1`,
        [sourceKey],
      );
      if (existing[0]) {
        return this.replayDailyClaim(manager, accountId, rewardDay, Number(existing[0].amount));
      }

      const status = await this.getStatusWithManager(manager, accountId, now);
      if (!status.active) throw new PremiumMembershipRequiredError();

      const claim = returningRows<CoinClaimRow>(
        await manager.query(
          `INSERT INTO economy.coin_ledger_entries
             (principal_type, principal_id, amount, reason, source_key, granted, metadata)
           VALUES ('account', $1, 0, $2, $3, false, NULL)
           ON CONFLICT ON CONSTRAINT "UQ_coin_ledger_entries_source_key" DO NOTHING
           RETURNING id, amount`,
          [accountId, CoinLedgerReason.PremiumDailyClaim, sourceKey],
        ),
      );
      if (claim.length === 0) {
        const concurrent = await manager.query<readonly { amount: string }[]>(
          'SELECT amount FROM economy.coin_ledger_entries WHERE source_key = $1',
          [sourceKey],
        );
        return this.replayDailyClaim(
          manager,
          accountId,
          rewardDay,
          Number(concurrent[0]?.amount ?? 0),
        );
      }

      await manager.query(
        `INSERT INTO economy.reward_day_pools (principal_type, principal_id, reward_day)
         VALUES ('account', $1, $2)
         ON CONFLICT ON CONSTRAINT "PK_reward_day_pools" DO NOTHING`,
        [accountId, rewardDay],
      );
      const poolRows = await manager.query<readonly PoolRow[]>(
        `SELECT coins_consumed, ads_completed, premium_claimed
         FROM economy.reward_day_pools
         WHERE principal_type = 'account' AND principal_id = $1 AND reward_day = $2
         FOR UPDATE`,
        [accountId, rewardDay],
      );
      const pool = poolRows[0] ?? {
        coins_consumed: 0,
        ads_completed: 0,
        premium_claimed: false,
      };
      const amount = premiumDailyClaimAmount(
        pool.coins_consumed,
        pool.premium_claimed,
      );

      await manager.query(
        `UPDATE economy.reward_day_pools
         SET coins_consumed = $3, premium_claimed = true, updated_at = now()
         WHERE principal_type = 'account' AND principal_id = $1 AND reward_day = $2`,
        [accountId, rewardDay, DAILY_POOL_COIN],
      );

      let balance: number;
      if (amount > 0) {
        const balanceRows = returningRows<BalanceRow>(
          await manager.query(
            `INSERT INTO economy.coin_balances (principal_type, principal_id, balance)
             VALUES ('account', $1, $2)
             ON CONFLICT ON CONSTRAINT "PK_coin_balances"
               DO UPDATE SET balance = economy.coin_balances.balance + EXCLUDED.balance,
                             updated_at = now()
             RETURNING balance`,
            [accountId, amount],
          ),
        );
        balance = Number(balanceRows[0].balance);
      } else {
        balance = await this.readCoinBalance(manager, accountId);
      }

      await manager.query(
        `UPDATE economy.coin_ledger_entries
         SET amount = $2, granted = true, metadata = $3
         WHERE id = $1`,
        [claim[0].id, amount, { rewardDay, closesPool: true }],
      );

      return {
        claimed: true,
        amount,
        balance,
        coinsConsumed: DAILY_POOL_COIN,
        replayed: false,
      };
    });
  }

  private async getStatusWithManager(
    manager: EntityManager,
    accountId: string,
    now: Date,
  ): Promise<MembershipStatus> {
    const rows = await manager.query<readonly MembershipPeriodRow[]>(
      `SELECT plan, current_status, ends_at, status_event_at
       FROM (
         SELECT DISTINCT ON (environment, original_transaction_id)
           environment, original_transaction_id, plan, current_status,
           ends_at, status_event_at, starts_at
         FROM economy.membership_periods
         WHERE account_id = $1
         ORDER BY environment, original_transaction_id, starts_at DESC, status_event_at DESC
       ) latest_subscription_periods
       ORDER BY ends_at DESC NULLS LAST, status_event_at DESC`,
      [accountId],
    );
    const periods = rows.map((row) => ({
      plan: row.plan,
      currentStatus: row.current_status,
      endsAt: toDate(row.ends_at),
      statusEventAt: toDate(row.status_event_at)!,
    }));
    const selected = selectMembershipPeriod(periods, now);
    if (!selected) {
      return {
        active: false,
        plan: null,
        lifecycle: null,
        expiresAt: null,
        themeAccess: false,
      };
    }
    const active = periodHasEntitlement(selected, now);
    return {
      active,
      plan: selected.plan,
      lifecycle: selected.currentStatus,
      expiresAt: selected.endsAt?.toISOString() ?? null,
      themeAccess: active,
    };
  }

  private async upsertPeriod(
    manager: EntityManager,
    event: VerifiedMembershipEvent,
    projection: MembershipPeriodProjection,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO economy.membership_periods
         (environment, provider_transaction_id, original_transaction_id,
          account_id, product_id, plan, period_type, starts_at, ends_at,
          current_status, status_event_at, credit_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT ON CONSTRAINT "PK_membership_periods"
       DO UPDATE SET
         original_transaction_id = EXCLUDED.original_transaction_id,
         product_id = EXCLUDED.product_id,
         plan = EXCLUDED.plan,
         period_type = EXCLUDED.period_type,
         starts_at = EXCLUDED.starts_at,
         ends_at = EXCLUDED.ends_at,
         current_status = EXCLUDED.current_status,
         status_event_at = EXCLUDED.status_event_at,
         credit_amount = EXCLUDED.credit_amount,
         updated_at = now()`,
      [
        event.environment,
        event.providerTransactionId,
        projection.originalTransactionId,
        projection.accountId,
        projection.productId,
        projection.plan,
        projection.periodType,
        projection.startsAt,
        projection.endsAt,
        projection.currentStatus,
        projection.statusEventAt,
        projection.creditAmount,
      ],
    );
  }

  private async applyCreditGrant(
    manager: EntityManager,
    environment: string,
    transactionId: string,
    projection: MembershipPeriodProjection,
  ): Promise<number> {
    if (projection.creditAmount === 0) return 0;
    const sourceKey = `membership:${environment}:${transactionId}`;
    const claim = returningRows<{ id: string }>(
      await manager.query(
        `INSERT INTO economy.ai_credit_ledger_entries
           (principal_type, principal_id, amount, reason, source_key, granted, metadata)
         VALUES ('account', $1, $2, $3, $4, true, $5)
         ON CONFLICT ON CONSTRAINT "UQ_ai_credit_ledger_entries_source_key" DO NOTHING
         RETURNING id`,
        [
          projection.accountId,
          projection.creditAmount,
          AiCreditLedgerReason.MembershipCreditGrant,
          sourceKey,
          { plan: projection.plan, providerTransactionId: transactionId },
        ],
      ),
    );
    if (claim.length === 0) return 0;

    await manager.query(
      `INSERT INTO economy.ai_credit_balances (principal_type, principal_id, balance)
       VALUES ('account', $1, $2)
       ON CONFLICT ON CONSTRAINT "PK_ai_credit_balances"
         DO UPDATE SET balance = economy.ai_credit_balances.balance + EXCLUDED.balance,
                       updated_at = now()`,
      [projection.accountId, projection.creditAmount],
    );
    await manager.query(
      `UPDATE economy.membership_periods
       SET credit_granted_at = COALESCE(credit_granted_at, now()), updated_at = now()
       WHERE environment = $1 AND provider_transaction_id = $2`,
      [environment, transactionId],
    );
    return projection.creditAmount;
  }

  private async applyCreditReversal(
    manager: EntityManager,
    environment: string,
    transactionId: string,
    projection: MembershipPeriodProjection,
  ): Promise<number> {
    if (projection.creditAmount === 0) return 0;
    const grantRows = await manager.query<readonly { id: string }[]>(
      `SELECT id FROM economy.ai_credit_ledger_entries WHERE source_key = $1`,
      [`membership:${environment}:${transactionId}`],
    );
    if (grantRows.length === 0) return 0;

    const claim = returningRows<{ id: string }>(
      await manager.query(
        `INSERT INTO economy.ai_credit_ledger_entries
           (principal_type, principal_id, amount, reason, source_key, granted, metadata)
         VALUES ('account', $1, $2, $3, $4, true, $5)
         ON CONFLICT ON CONSTRAINT "UQ_ai_credit_ledger_entries_source_key" DO NOTHING
         RETURNING id`,
        [
          projection.accountId,
          -projection.creditAmount,
          AiCreditLedgerReason.MembershipReversal,
          `membership_reversal:${environment}:${transactionId}`,
          { plan: projection.plan, providerTransactionId: transactionId },
        ],
      ),
    );
    if (claim.length === 0) return 0;

    await manager.query(
      `INSERT INTO economy.ai_credit_balances (principal_type, principal_id, balance)
       VALUES ('account', $1, $2)
       ON CONFLICT ON CONSTRAINT "PK_ai_credit_balances"
         DO UPDATE SET balance = economy.ai_credit_balances.balance + EXCLUDED.balance,
                       updated_at = now()`,
      [projection.accountId, -projection.creditAmount],
    );
    await manager.query(
      `UPDATE economy.membership_periods
       SET reversed_at = COALESCE(reversed_at, now()), updated_at = now()
       WHERE environment = $1 AND provider_transaction_id = $2`,
      [environment, transactionId],
    );
    return projection.creditAmount;
  }

  private async replayDailyClaim(
    manager: EntityManager,
    accountId: string,
    rewardDay: string,
    amount: number,
  ): Promise<PremiumDailyClaimResult> {
    const [balance, poolRows] = await Promise.all([
      this.readCoinBalance(manager, accountId),
      manager.query<readonly PoolRow[]>(
        `SELECT coins_consumed, ads_completed, premium_claimed
         FROM economy.reward_day_pools
         WHERE principal_type = 'account' AND principal_id = $1 AND reward_day = $2`,
        [accountId, rewardDay],
      ),
    ]);
    return {
      claimed: true,
      amount,
      balance,
      coinsConsumed: poolRows[0]?.coins_consumed ?? DAILY_POOL_COIN,
      replayed: true,
    };
  }

  private async readCoinBalance(manager: EntityManager, accountId: string): Promise<number> {
    const rows = await manager.query<readonly BalanceRow[]>(
      `SELECT balance FROM economy.coin_balances
       WHERE principal_type = 'account' AND principal_id = $1`,
      [accountId],
    );
    return Number(rows[0]?.balance ?? 0);
  }
}

function toVerifiedEvent(row: MembershipEventRow): VerifiedMembershipEvent {
  return {
    environment: row.environment,
    providerEventId: row.provider_event_id,
    providerTransactionId: row.provider_transaction_id,
    originalTransactionId: row.original_transaction_id,
    accountId: row.account_id,
    type: row.event_type,
    productId: row.product_id,
    periodType: row.period_type,
    eventAt: new Date(row.event_at),
    purchasedAt: new Date(row.purchased_at),
    expiresAt: toDate(row.expires_at),
    gracePeriodExpiresAt: toDate(row.grace_period_expires_at),
    cancelReason: row.cancel_reason,
  };
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}
