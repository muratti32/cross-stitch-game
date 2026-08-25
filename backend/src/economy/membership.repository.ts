import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { RegisteredAccountStatus } from '../auth/entities';
import { returningRows } from '../database/query-results';
import { DAILY_POOL_COIN } from './economy.constants';
import { AiCreditLedgerReason, CoinLedgerReason } from './entities';
import {
  periodHasEntitlement,
  projectMembershipPeriod,
  projectScheduledChange,
  selectMembershipPeriod,
  type MembershipLifecycle,
  type MembershipPeriodProjection,
  type MembershipScheduledChange,
  type VerifiedMembershipEvent,
} from './membership-projection';
import type { PremiumPlan } from './membership.constants';
import { premiumDailyClaimAmount } from './membership.constants';
import type { CommerceOwner } from './commerce-owner';
import { toCommerceOwnerPrincipal } from './commerce-owner';
import { paidDebitUpdateExpression } from './paid-reserve';

interface MembershipEventRow {
  environment: 'sandbox' | 'production';
  provider_event_id: string;
  provider_transaction_id: string;
  original_transaction_id: string;
  account_id: string | null;
  guest_installation_id: string | null;
  event_type: string;
  product_id: string;
  period_type: string;
  event_at: Date | string;
  purchased_at: Date | string;
  expires_at: Date | string | null;
  grace_period_expires_at: Date | string | null;
  cancel_reason: string | null;
  new_product_id: string | null;
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
  periodExists: boolean;
  creditGranted: number;
  creditReversed: number;
}

export interface MembershipTransferInput {
  environment: 'sandbox' | 'production';
  fromAccountIds: readonly string[];
  fromGuestIds?: readonly string[];
  toOwner: CommerceOwner;
}

export interface MembershipTransferResult {
  eventsMoved: number;
  periodsMoved: number;
}

export interface MembershipScheduledChangeView {
  targetPlan: PremiumPlan;
  effectiveAt: string;
}

export interface MembershipStatus {
  active: boolean;
  plan: PremiumPlan | null;
  lifecycle: MembershipLifecycle | null;
  expiresAt: string | null;
  themeAccess: boolean;
  scheduledChange: MembershipScheduledChangeView | null;
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
      // Every recorded row for one provider transaction must agree on the
      // owner, so ask for all of them rather than an arbitrary single row: a
      // partially rebound transaction would otherwise accept or reject the
      // same claim depending on which row Postgres happened to return.
      const ownerRows = await manager.query<readonly { account_id: string | null; guest_installation_id: string | null }[]>(
        `SELECT DISTINCT account_id, guest_installation_id
         FROM economy.membership_events
         WHERE environment = $1 AND provider_transaction_id = $2`,
        [event.environment, event.providerTransactionId],
      );
      if (ownerRows.some((row) => !sameOwner(row, event.owner))) {
        const restored = await this.restoreDeletedAccountSubscription(manager, ownerRows, event);
        if (!restored) {
          return {
            recorded: false,
            rejectedOtherAccount: true,
            periodExists: false,
            creditGranted: 0,
            creditReversed: 0,
          };
        }
      }

      const inserted = returningRows<{ provider_event_id: string }>(
        await manager.query(
          `INSERT INTO economy.membership_events
             (environment, provider_event_id, provider_transaction_id,
              original_transaction_id, account_id, guest_installation_id, event_type, product_id,
              period_type, event_at, purchased_at, expires_at,
              grace_period_expires_at, cancel_reason, new_product_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT ON CONSTRAINT "PK_membership_events" DO NOTHING
           RETURNING provider_event_id`,
          [
            event.environment,
            event.providerEventId,
            event.providerTransactionId,
            event.originalTransactionId,
              event.owner.type === 'account' ? event.owner.accountId : null,
              event.owner.type === 'guest' ? event.owner.guestInstallationId : null,
            event.type,
            event.productId,
            event.periodType,
            event.eventAt,
            event.purchasedAt,
            event.expiresAt,
            event.gracePeriodExpiresAt,
            event.cancelReason,
            event.newProductId,
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
          periodExists: false,
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
        periodExists: true,
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
  /**
   * Reports who currently owns every recorded event of one provider
   * transaction. A webhook that is refused as owned by somebody else needs the
   * current owner to decide whether the claim is a real conflict or the same
   * player reaching their purchase through a new identity.
   */
  async getTransactionOwners(
    environment: 'sandbox' | 'production',
    providerTransactionId: string,
  ): Promise<readonly CommerceOwner[]> {
    const rows = await this.dataSource.query<
      readonly { account_id: string | null; guest_installation_id: string | null }[]
    >(
      `SELECT DISTINCT account_id, guest_installation_id
       FROM economy.membership_events
       WHERE environment = $1 AND provider_transaction_id = $2`,
      [environment, providerTransactionId],
    );
    return rows.flatMap<CommerceOwner>((row) => {
      if (row.account_id !== null) {
        return [{ type: 'account', accountId: row.account_id }];
      }
      return row.guest_installation_id === null
        ? []
        : [{ type: 'guest', guestInstallationId: row.guest_installation_id }];
    });
  }

  async transferMembership(input: MembershipTransferInput): Promise<MembershipTransferResult> {
    const fromGuestIds = input.fromGuestIds ?? [];
    if (input.fromAccountIds.length === 0 && fromGuestIds.length === 0) {
      return { eventsMoved: 0, periodsMoved: 0 };
    }
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const transactionRows = await manager.query<
        readonly { provider_transaction_id: string }[]
      >(
        `SELECT DISTINCT provider_transaction_id
         FROM economy.membership_events
         WHERE environment = $1
           AND (account_id = ANY($2::uuid[]) OR guest_installation_id = ANY($3::uuid[]))
         ORDER BY provider_transaction_id`,
        [input.environment, [...input.fromAccountIds], [...fromGuestIds]],
      );
      // Take the same per-transaction locks recordVerifiedEvent takes, in a
      // stable order, so a transfer and an in-flight event for one of these
      // transactions cannot interleave (or deadlock) mid-rebind.
      for (const row of transactionRows) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${input.environment}:${row.provider_transaction_id}`,
        ]);
      }

      // Move by transaction rather than by source account. A transaction whose
      // rows are spread over several previous identities has to end up whole on
      // the destination, otherwise the ownership guard keeps seeing a conflict.
      const transactionIds = transactionRows.map((row) => row.provider_transaction_id);
      if (transactionIds.length === 0) {
        return { eventsMoved: 0, periodsMoved: 0 };
      }
      // The destination may be a Guest Installation: RevenueCat moves the store
      // purchases to a fresh anonymous subscriber when the player signs out, and
      // the Membership has to follow that identity rather than stay stranded on
      // the previous owner (ADR-0044).
      const toAccountId = input.toOwner.type === 'account' ? input.toOwner.accountId : null;
      const toGuestId = input.toOwner.type === 'guest' ? input.toOwner.guestInstallationId : null;
      const movedEvents = await manager.query<readonly { provider_event_id: string }[]>(
        `UPDATE economy.membership_events
         SET account_id = $3, guest_installation_id = $4
         WHERE environment = $1
           AND provider_transaction_id = ANY($2::varchar[])
           AND (account_id IS DISTINCT FROM $3 OR guest_installation_id IS DISTINCT FROM $4)
         RETURNING provider_event_id`,
        [input.environment, transactionIds, toAccountId, toGuestId],
      );
      const movedPeriods = await manager.query<
        readonly { provider_transaction_id: string }[]
      >(
        `UPDATE economy.membership_periods
         SET account_id = $3, guest_installation_id = $4, updated_at = now()
         WHERE environment = $1
           AND provider_transaction_id = ANY($2::varchar[])
           AND (account_id IS DISTINCT FROM $3 OR guest_installation_id IS DISTINCT FROM $4)
         RETURNING provider_transaction_id`,
        [input.environment, transactionIds, toAccountId, toGuestId],
      );

      return {
        eventsMoved: movedEvents.length,
        periodsMoved: movedPeriods.length,
      };
    });
  }

  async getStatus(owner: CommerceOwner, now: Date = new Date()): Promise<MembershipStatus> {
    return this.getStatusWithManager(this.dataSource.manager, owner, now);
  }

  async claimPremiumDailyCoin(
    owner: CommerceOwner,
    rewardDay: string,
    now: Date = new Date(),
  ): Promise<PremiumDailyClaimResult> {
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const principal = toCommerceOwnerPrincipal(owner);
      const sourceKey = `premium_daily:${principal.principalType === 'guest' ? 'guest:' : ''}${principal.principalId}:${rewardDay}`;
      const existing = await manager.query<readonly { amount: string }[]>(
        `SELECT amount
         FROM economy.coin_ledger_entries
         WHERE source_key = $1`,
        [sourceKey],
      );
      if (existing[0]) {
        return this.replayDailyClaim(manager, owner, rewardDay, Number(existing[0].amount));
      }

      const status = await this.getStatusWithManager(manager, owner, now);
      if (!status.active) throw new PremiumMembershipRequiredError();

      // The identity-keyed source key above cannot see a claim the erased
      // identity already made, so a restored subscription is also checked
      // against the reward days tombstoned for its store transaction.
      if (await this.premiumDayIsTombstoned(manager, owner, rewardDay)) {
        return this.replayDailyClaim(manager, owner, rewardDay, 0);
      }

      const claim = returningRows<CoinClaimRow>(
        await manager.query(
          `INSERT INTO economy.coin_ledger_entries
             (principal_type, principal_id, amount, reason, source_key, granted, metadata)
           VALUES ($1, $2, 0, $3, $4, false, NULL)
           ON CONFLICT ON CONSTRAINT "UQ_coin_ledger_entries_source_key" DO NOTHING
           RETURNING id, amount`,
          [principal.principalType, principal.principalId, CoinLedgerReason.PremiumDailyClaim, sourceKey],
        ),
      );
      if (claim.length === 0) {
        const concurrent = await manager.query<readonly { amount: string }[]>(
          'SELECT amount FROM economy.coin_ledger_entries WHERE source_key = $1',
          [sourceKey],
        );
        return this.replayDailyClaim(
          manager,
          owner,
          rewardDay,
          Number(concurrent[0]?.amount ?? 0),
        );
      }

      await manager.query(
        `INSERT INTO economy.reward_day_pools (principal_type, principal_id, reward_day)
         VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT "PK_reward_day_pools" DO NOTHING`,
        [principal.principalType, principal.principalId, rewardDay],
      );
      const poolRows = await manager.query<readonly PoolRow[]>(
        `SELECT coins_consumed, ads_completed, premium_claimed
         FROM economy.reward_day_pools
         WHERE principal_type = $1 AND principal_id = $2 AND reward_day = $3
         FOR UPDATE`,
        [principal.principalType, principal.principalId, rewardDay],
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
         SET coins_consumed = $4, premium_claimed = true, updated_at = now()
         WHERE principal_type = $1 AND principal_id = $2 AND reward_day = $3`,
        [principal.principalType, principal.principalId, rewardDay, DAILY_POOL_COIN],
      );

      let balance: number;
      if (amount > 0) {
        const balanceRows = returningRows<BalanceRow>(
          await manager.query(
            `INSERT INTO economy.coin_balances (principal_type, principal_id, balance)
             VALUES ($1, $2, $3)
             ON CONFLICT ON CONSTRAINT "PK_coin_balances"
               DO UPDATE SET balance = economy.coin_balances.balance + EXCLUDED.balance,
                             updated_at = now()
             RETURNING balance`,
            [principal.principalType, principal.principalId, amount],
          ),
        );
        balance = Number(balanceRows[0].balance);
      } else {
        balance = await this.readCoinBalance(manager, owner);
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
    owner: CommerceOwner,
    now: Date,
  ): Promise<MembershipStatus> {
    const rows = await manager.query<readonly MembershipPeriodRow[]>(
      `SELECT plan, current_status, ends_at, status_event_at
       FROM (
         SELECT DISTINCT ON (environment, original_transaction_id)
           environment, original_transaction_id, plan, current_status,
           ends_at, status_event_at, starts_at
         FROM economy.membership_periods
         WHERE ${ownerWhere(owner)}
         ORDER BY environment, original_transaction_id, starts_at DESC, status_event_at DESC
       ) latest_subscription_periods
       ORDER BY ends_at DESC NULLS LAST, status_event_at DESC`,
      [ownerId(owner)],
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
        scheduledChange: null,
      };
    }
    const active = periodHasEntitlement(selected, now);
    const scheduledChange = active
      ? await this.getScheduledChange(manager, owner, { plan: selected.plan, endsAt: selected.endsAt })
      : null;
    return {
      active,
      plan: selected.plan,
      lifecycle: selected.currentStatus,
      expiresAt: selected.endsAt?.toISOString() ?? null,
      themeAccess: active,
      scheduledChange: scheduledChange === null
        ? null
        : { targetPlan: scheduledChange.targetPlan, effectiveAt: scheduledChange.effectiveAt.toISOString() },
    };
  }

  /**
   * Finds the latest PRODUCT_CHANGE naming a downgrade target that has not yet
   * been superseded by a Membership Period on the same subscription lineage
   * (`original_transaction_id`) for that target product — the provider groups
   * a plan change and its eventual activating RENEWAL under one lineage but
   * distinct provider transaction ids, so lineage rather than transaction id is
   * what proves activation happened.
   */
  private async getScheduledChange(
    manager: EntityManager,
    owner: CommerceOwner,
    active: { plan: PremiumPlan; endsAt: Date | null },
  ): Promise<MembershipScheduledChange | null> {
    const rows = await manager.query<readonly MembershipEventRow[]>(
      `SELECT me.*
       FROM economy.membership_events me
       WHERE me.${ownerWhere(owner)} AND me.event_type = 'PRODUCT_CHANGE' AND me.new_product_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM economy.membership_periods mp
           WHERE mp.environment = me.environment
             AND mp.original_transaction_id = me.original_transaction_id
             AND mp.product_id = me.new_product_id
         )
       ORDER BY me.event_at DESC, me.provider_event_id DESC
       LIMIT 1`,
      [ownerId(owner)],
    );
    const row = rows[0];
    return projectScheduledChange(row === undefined ? undefined : toVerifiedEvent(row), active);
  }

  /**
   * Account deletion intentionally leaves bounded subscription history so an
   * active store subscription can be recovered. A Guest restore may re-own
   * only that Premium history; deleted balances, content, and one-time grants
   * remain unreachable and are never copied to the Guest.
   */
  private async restoreDeletedAccountSubscription(
    manager: EntityManager,
    ownerRows: readonly { account_id: string | null; guest_installation_id: string | null }[],
    event: VerifiedMembershipEvent,
  ): Promise<boolean> {
    if (event.owner.type !== 'guest' || ownerRows.length === 0) return false;
    const accountIds = ownerRows
      .map((row) => row.account_id)
      .filter((id): id is string => id !== null);
    if (accountIds.length !== ownerRows.length) return false;

    const deletedAccounts = await manager.query<readonly { id: string }[]>(
      `SELECT id
       FROM auth.registered_accounts
       WHERE id = ANY($1::uuid[]) AND status = $2`,
      [accountIds, RegisteredAccountStatus.Deleted],
    );
    if (deletedAccounts.length !== accountIds.length) return false;

    await manager.query(
      `UPDATE economy.membership_events
       SET account_id = NULL, guest_installation_id = $2
       WHERE environment = $1 AND provider_transaction_id = $3`,
      [event.environment, event.owner.guestInstallationId, event.providerTransactionId],
    );
    await manager.query(
      `UPDATE economy.membership_periods
       SET account_id = NULL, guest_installation_id = $2, updated_at = now()
       WHERE environment = $1 AND provider_transaction_id = $3`,
      [event.environment, event.owner.guestInstallationId, event.providerTransactionId],
    );
    return true;
  }

  private async upsertPeriod(
    manager: EntityManager,
    event: VerifiedMembershipEvent,
    projection: MembershipPeriodProjection,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO economy.membership_periods
         (environment, provider_transaction_id, original_transaction_id,
          account_id, guest_installation_id, product_id, plan, period_type, starts_at, ends_at,
          current_status, status_event_at, credit_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT ON CONSTRAINT "PK_membership_periods"
       DO UPDATE SET
         original_transaction_id = EXCLUDED.original_transaction_id,
         account_id = EXCLUDED.account_id,
         guest_installation_id = EXCLUDED.guest_installation_id,
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
        projection.owner.type === 'account' ? projection.owner.accountId : null,
        projection.owner.type === 'guest' ? projection.owner.guestInstallationId : null,
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
    const principal = toCommerceOwnerPrincipal(projection.owner);
    const sourceKey = `membership:${environment}:${transactionId}`;
    // A Guest Data Reset erases the ledger row that made this grant unique, so
    // the surviving tombstone is what keeps a restored subscription from
    // minting its Membership Credit a second time.
    const tombstones = await manager.query<readonly { source_key: string }[]>(
      `SELECT source_key FROM economy.commerce_grant_tombstones WHERE source_key = $1`,
      [sourceKey],
    );
    if (tombstones.length > 0) return 0;
    const claim = returningRows<{ id: string }>(
      await manager.query(
        `INSERT INTO economy.ai_credit_ledger_entries
           (principal_type, principal_id, amount, reason, source_key, granted, metadata)
         VALUES ($1, $2, $3, $4, $5, true, $6)
         ON CONFLICT ON CONSTRAINT "UQ_ai_credit_ledger_entries_source_key" DO NOTHING
         RETURNING id`,
        [
          principal.principalType,
          principal.principalId,
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
       VALUES ($1, $2, $3)
       ON CONFLICT ON CONSTRAINT "PK_ai_credit_balances"
         DO UPDATE SET balance = economy.ai_credit_balances.balance + EXCLUDED.balance,
                       updated_at = now()`,
      [principal.principalType, principal.principalId, projection.creditAmount],
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
    const principal = toCommerceOwnerPrincipal(projection.owner);
    const grantRows = await manager.query<readonly { id: string }[]>(
      `SELECT id FROM economy.ai_credit_ledger_entries WHERE source_key = $1`,
      [`membership:${environment}:${transactionId}`],
    );
    if (grantRows.length === 0) return 0;

    const claim = returningRows<{ id: string }>(
      await manager.query(
        `INSERT INTO economy.ai_credit_ledger_entries
           (principal_type, principal_id, amount, reason, source_key, granted, metadata)
         VALUES ($1, $2, $3, $4, $5, true, $6)
         ON CONFLICT ON CONSTRAINT "UQ_ai_credit_ledger_entries_source_key" DO NOTHING
         RETURNING id`,
        [
          principal.principalType,
          principal.principalId,
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
       VALUES ($1, $2, $3)
       ON CONFLICT ON CONSTRAINT "PK_ai_credit_balances"
         DO UPDATE SET balance = economy.ai_credit_balances.balance + EXCLUDED.balance,
                       paid_balance = ${paidDebitUpdateExpression('economy.ai_credit_balances')},
                       updated_at = now()`,
      [principal.principalType, principal.principalId, -projection.creditAmount],
    );
    await manager.query(
      `UPDATE economy.membership_periods
       SET reversed_at = COALESCE(reversed_at, now()), updated_at = now()
       WHERE environment = $1 AND provider_transaction_id = $2`,
      [environment, transactionId],
    );
    return projection.creditAmount;
  }

  /**
   * A reward day claimed before a Guest Data Reset is tombstoned under the
   * store transaction that paid for it. The restored subscription finds it
   * even though the identity that claimed it is gone.
   */
  private async premiumDayIsTombstoned(
    manager: EntityManager,
    owner: CommerceOwner,
    rewardDay: string,
  ): Promise<boolean> {
    const tombstones = await manager.query<readonly { source_key: string }[]>(
      `SELECT tombstone.source_key
       FROM economy.membership_periods period
       JOIN economy.commerce_grant_tombstones tombstone
         ON tombstone.source_key = 'premium_daily:' || period.environment || ':'
                                   || period.provider_transaction_id || ':' || $2
       WHERE period.${ownerWhere(owner)}
       LIMIT 1`,
      [ownerId(owner), rewardDay],
    );
    return tombstones.length > 0;
  }

  private async replayDailyClaim(
    manager: EntityManager,
    owner: CommerceOwner,
    rewardDay: string,
    amount: number,
  ): Promise<PremiumDailyClaimResult> {
    const [balance, poolRows] = await Promise.all([
      this.readCoinBalance(manager, owner),
      manager.query<readonly PoolRow[]>(
        `SELECT coins_consumed, ads_completed, premium_claimed
         FROM economy.reward_day_pools
         WHERE principal_type = $1 AND principal_id = $2 AND reward_day = $3`,
        [toCommerceOwnerPrincipal(owner).principalType, toCommerceOwnerPrincipal(owner).principalId, rewardDay],
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

  private async readCoinBalance(manager: EntityManager, owner: CommerceOwner): Promise<number> {
    const principal = toCommerceOwnerPrincipal(owner);
    const rows = await manager.query<readonly BalanceRow[]>(
      `SELECT balance FROM economy.coin_balances
       WHERE principal_type = $1 AND principal_id = $2`,
      [principal.principalType, principal.principalId],
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
    owner: row.account_id !== null
      ? { type: 'account', accountId: row.account_id }
      : { type: 'guest', guestInstallationId: row.guest_installation_id! },
    type: row.event_type,
    productId: row.product_id,
    periodType: row.period_type,
    eventAt: new Date(row.event_at),
    purchasedAt: new Date(row.purchased_at),
    expiresAt: toDate(row.expires_at),
    gracePeriodExpiresAt: toDate(row.grace_period_expires_at),
    cancelReason: row.cancel_reason,
    newProductId: row.new_product_id,
  };
}

function ownerId(owner: CommerceOwner): string {
  return owner.type === 'account' ? owner.accountId : owner.guestInstallationId;
}

function ownerWhere(owner: CommerceOwner): string {
  return owner.type === 'account' ? 'account_id = $1' : 'guest_installation_id = $1';
}

function sameOwner(row: { account_id: string | null; guest_installation_id: string | null }, owner: CommerceOwner): boolean {
  return owner.type === 'account'
    ? row.account_id === owner.accountId && row.guest_installation_id === null
    : row.account_id === null && row.guest_installation_id === owner.guestInstallationId;
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}
