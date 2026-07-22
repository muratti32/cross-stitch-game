import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { returningRows } from '../database/query-results';
import {
  AD_REWARD_COIN,
  DAILY_AD_LIMIT,
  DAILY_POOL_COIN,
  firstCompletionReward,
  unlockPrice,
  UnlockPriceTier,
  DAILY_TASK_COIN,
  DailyTaskKey,
} from './economy.constants';
import { CoinLedgerReason } from './entities';

export interface LedgerPrincipal {
  type: 'guest' | 'account';
  id: string;
}

export interface AdRewardGrantResult {
  /** Whether this callback actually credited coin to the balance. */
  granted: boolean;
  /** Coin credited by this callback (0 when the pool/limit was exhausted). */
  amount: number;
  /** Balance after the grant (or current balance when nothing was granted). */
  balance: number;
  /** Rewarded ads counted against the Reward Day after this callback. */
  adsCompleted: number;
  /** Coin already consumed from the Reward Day pool after this callback. */
  coinsConsumed: number;
  /** True when this call collapsed onto an already-recorded callback. */
  replayed: boolean;
}

export interface RewardDayPoolStatus {
  adsCompleted: number;
  coinsConsumed: number;
}

export interface FirstCompletionGrantResult {
  /** Whether this call actually minted the First Completion Reward. */
  granted: boolean;
  /** Coin credited (the tier amount, or 0 when the reward was already minted). */
  amount: number;
  /** Balance after the grant (or current balance on a replay). */
  balance: number;
  /** True when the reward for this (principal, pattern) already existed. */
  replayed: boolean;
}

export interface DailyTaskGrantResult {
  granted: boolean;   // true when this call minted the task reward
  amount: number;     // 10 on grant, 0 on replay
  balance: number;    // balance after (or current on replay)
  replayed: boolean;  // true when the task was already granted this Reward Day
}

export interface UnlockSpendResult {
  alreadyUnlocked: boolean;   // true when the entitlement already existed (no charge)
  price: number;              // tier price
  balance: number;            // balance after (or current on already-unlocked)
}

export class InsufficientCoinError extends Error {
  constructor(readonly price: number, readonly balance: number) {
    super('insufficient_balance');
  }
}

interface ClaimRow {
  id: string;
}

interface PoolRow {
  coins_consumed: number;
  ads_completed: number;
}

interface LedgerOutcomeRow {
  amount: string;
  granted: boolean;
}

interface BalanceRow {
  balance: string;
}

/**
 * Server-authoritative Stitch Coin ledger (ADR-0011, ADR-0026). The client can
 * never mutate coin directly; every movement lands here as an append-only entry
 * keyed by an idempotent `source_key`.
 */
@Injectable()
export class CoinLedgerRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Grant a verified Rewarded Ad reward idempotently by `sourceKey`
   * (`ad:<transaction_id>`). A duplicate or replayed AdMob callback collapses to
   * the already-recorded outcome. A callback received after the Reward Day pool
   * (30 coin) or ad limit (3) is exhausted is recorded for idempotency but
   * grants nothing and consumes nothing (ADR-0033).
   */
  async grantAdReward(
    principal: LedgerPrincipal,
    rewardDay: string,
    sourceKey: string,
    amount: number = AD_REWARD_COIN,
  ): Promise<AdRewardGrantResult> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Claim the idempotency latch. The UNIQUE(source_key) constraint makes
      //    the first inserter the sole owner of this grant; a concurrent
      //    duplicate blocks until commit, then sees the conflict and replays.
      const claim = returningRows<ClaimRow>(
        await manager.query(
          `INSERT INTO economy.coin_ledger_entries
             (principal_type, principal_id, amount, reason, source_key, granted, metadata)
           VALUES ($1, $2, 0, $3, $4, false, NULL)
           ON CONFLICT ON CONSTRAINT "UQ_coin_ledger_entries_source_key" DO NOTHING
           RETURNING id`,
          [principal.type, principal.id, CoinLedgerReason.AdReward, sourceKey],
        ),
      );

      if (claim.length === 0) {
        return this.replayExisting(manager, principal, rewardDay, sourceKey);
      }

      const ledgerId = claim[0].id;

      // 2. Serialize concurrent grants for this principal/day on the pool row so
      //    two ads cannot both read the same remaining capacity.
      await manager.query(
        `INSERT INTO economy.reward_day_pools (principal_type, principal_id, reward_day)
         VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT "PK_reward_day_pools" DO NOTHING`,
        [principal.type, principal.id, rewardDay],
      );
      const poolRows = await manager.query<readonly PoolRow[]>(
        `SELECT coins_consumed, ads_completed
         FROM economy.reward_day_pools
         WHERE principal_type = $1 AND principal_id = $2 AND reward_day = $3
         FOR UPDATE`,
        [principal.type, principal.id, rewardDay],
      );
      const pool = poolRows[0] ?? { coins_consumed: 0, ads_completed: 0 };

      const hasCapacity =
        pool.ads_completed < DAILY_AD_LIMIT &&
        pool.coins_consumed + amount <= DAILY_POOL_COIN;

      if (!hasCapacity) {
        const rejection =
          pool.ads_completed >= DAILY_AD_LIMIT
            ? 'ad_limit_reached'
            : 'pool_exhausted';
        await manager.query(
          `UPDATE economy.coin_ledger_entries
             SET metadata = $2
           WHERE id = $1`,
          [ledgerId, { granted: false, rejection }],
        );
        const balance = await this.readBalance(manager, principal);
        return {
          granted: false,
          amount: 0,
          balance,
          adsCompleted: pool.ads_completed,
          coinsConsumed: pool.coins_consumed,
          replayed: false,
        };
      }

      const updatedPool = returningRows<PoolRow>(
        await manager.query(
          `UPDATE economy.reward_day_pools
             SET coins_consumed = coins_consumed + $4,
                 ads_completed = ads_completed + 1,
                 updated_at = now()
           WHERE principal_type = $1 AND principal_id = $2 AND reward_day = $3
           RETURNING coins_consumed, ads_completed`,
          [principal.type, principal.id, rewardDay, amount],
        ),
      );

      const balanceRows = returningRows<BalanceRow>(
        await manager.query(
          `INSERT INTO economy.coin_balances (principal_type, principal_id, balance)
           VALUES ($1, $2, $3)
           ON CONFLICT ON CONSTRAINT "PK_coin_balances"
             DO UPDATE SET balance = economy.coin_balances.balance + EXCLUDED.balance,
                           updated_at = now()
           RETURNING balance`,
          [principal.type, principal.id, amount],
        ),
      );

      await manager.query(
        `UPDATE economy.coin_ledger_entries
           SET amount = $2, granted = true, metadata = $3
         WHERE id = $1`,
        [ledgerId, amount, { granted: true, rewardDay }],
      );

      return {
        granted: true,
        amount,
        balance: Number(balanceRows[0].balance),
        adsCompleted: updatedPool[0].ads_completed,
        coinsConsumed: updatedPool[0].coins_consumed,
        replayed: false,
      };
    });
  }

  /**
   * Mint the First Completion Reward for an eligible catalog Pattern (ADR-0011),
   * exactly once per `(principal, pattern)`. Runs inside the caller's
   * transaction (`manager`) so the reward commits atomically with the session
   * completion. A Replay Session or a duplicate completion collapses onto the
   * existing ledger row via the UNIQUE `source_key` and never double-credits.
   * The caller is responsible for eligibility (catalog visibility, not a
   * Personal Pattern); this method assumes the Pattern qualifies.
   */
  async grantFirstCompletion(
    manager: EntityManager,
    principal: LedgerPrincipal,
    patternId: string,
    cells: number,
  ): Promise<FirstCompletionGrantResult> {
    const amount = firstCompletionReward(cells);
    const sourceKey = `first_completion:${principal.type}:${principal.id}:${patternId}`;

    const claim = returningRows<ClaimRow>(
      await manager.query(
        `INSERT INTO economy.coin_ledger_entries
           (principal_type, principal_id, amount, reason, source_key, granted, metadata)
         VALUES ($1, $2, $3, $4, $5, true, $6)
         ON CONFLICT ON CONSTRAINT "UQ_coin_ledger_entries_source_key" DO NOTHING
         RETURNING id`,
        [
          principal.type,
          principal.id,
          amount,
          CoinLedgerReason.FirstCompletion,
          sourceKey,
          { patternId, cells },
        ],
      ),
    );

    if (claim.length === 0) {
      const balance = await this.readBalance(manager, principal);
      return { granted: false, amount: 0, balance, replayed: true };
    }

    const balanceRows = returningRows<BalanceRow>(
      await manager.query(
        `INSERT INTO economy.coin_balances (principal_type, principal_id, balance)
         VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT "PK_coin_balances"
           DO UPDATE SET balance = economy.coin_balances.balance + EXCLUDED.balance,
                         updated_at = now()
         RETURNING balance`,
        [principal.type, principal.id, amount],
      ),
    );

    return {
      granted: true,
      amount,
      balance: Number(balanceRows[0].balance),
      replayed: false,
    };
  }

  async grantDailyTask(
    manager: EntityManager,
    principal: LedgerPrincipal,
    rewardDay: string,
    taskKey: DailyTaskKey,
  ): Promise<DailyTaskGrantResult> {
    const amount = DAILY_TASK_COIN;
    const sourceKey = `daily_task:${principal.type}:${principal.id}:${rewardDay}:${taskKey}`;

    const claim = returningRows<ClaimRow>(
      await manager.query(
        `INSERT INTO economy.coin_ledger_entries
           (principal_type, principal_id, amount, reason, source_key, granted, metadata)
         VALUES ($1, $2, $3, $4, $5, true, $6)
         ON CONFLICT ON CONSTRAINT "UQ_coin_ledger_entries_source_key" DO NOTHING
         RETURNING id`,
        [
          principal.type,
          principal.id,
          amount,
          CoinLedgerReason.DailyTask,
          sourceKey,
          { rewardDay, taskKey },
        ],
      ),
    );

    if (claim.length === 0) {
      const balance = await this.readBalance(manager, principal);
      return { granted: false, amount: 0, balance, replayed: true };
    }

    const balanceRows = returningRows<BalanceRow>(
      await manager.query(
        `INSERT INTO economy.coin_balances (principal_type, principal_id, balance)
         VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT "PK_coin_balances"
           DO UPDATE SET balance = economy.coin_balances.balance + EXCLUDED.balance,
                         updated_at = now()
         RETURNING balance`,
        [principal.type, principal.id, amount],
      ),
    );

    return {
      granted: true,
      amount,
      balance: Number(balanceRows[0].balance),
      replayed: false,
    };
  }

  async grantedDailyTaskKeys(
    manager: EntityManager,
    principal: LedgerPrincipal,
    rewardDay: string,
  ): Promise<Set<string>> {
    const rows = await manager.query<{ source_key: string }[]>(
      `SELECT source_key
       FROM economy.coin_ledger_entries
       WHERE principal_type = $1
         AND principal_id = $2
         AND reason = $3
         AND source_key LIKE $4`,
      [
        principal.type,
        principal.id,
        CoinLedgerReason.DailyTask,
        `daily_task:${principal.type}:${principal.id}:${rewardDay}:%`,
      ],
    );

    const keys = new Set<string>();
    for (const r of rows) {
      const parts = r.source_key.split(':');
      const last = parts[parts.length - 1];
      if (last) {
        keys.add(last);
      }
    }
    return keys;
  }

  /**
   * Spend Stitch Coin to unlock a pattern. Server-authoritative price mapping,
   * idempotency latch, balance checking and debiting are all handled within a
   * single transaction (ADR-0011).
   */
  async spendPatternUnlock(
    principal: LedgerPrincipal,
    patternId: string,
    tier: UnlockPriceTier,
  ): Promise<UnlockSpendResult> {
    const price = unlockPrice(tier);
    return this.dataSource.transaction(async (manager) => {
      // 1. Claim the entitlement latch
      const claim = returningRows<{ pattern_id: string }>(
        await manager.query(
          `INSERT INTO economy.pattern_unlocks (principal_type, principal_id, pattern_id)
           VALUES ($1, $2, $3)
           ON CONFLICT ON CONSTRAINT "PK_pattern_unlocks" DO NOTHING
           RETURNING pattern_id`,
          [principal.type, principal.id, patternId],
        ),
      );

      if (claim.length === 0) {
        const balance = await this.readBalance(manager, principal);
        return { alreadyUnlocked: true, price, balance };
      }

      // 2. Lock and read the balance row FOR UPDATE
      const balanceRows = await manager.query<readonly BalanceRow[]>(
        `SELECT balance FROM economy.coin_balances
         WHERE principal_type = $1 AND principal_id = $2
         FOR UPDATE`,
        [principal.type, principal.id],
      );
      const balance = balanceRows.length === 0 ? 0 : Number(balanceRows[0].balance);

      if (balance < price) {
        throw new InsufficientCoinError(price, balance);
      }

      // 3. Write debit ledger entry
      const sourceKey = `unlock:${principal.type}:${principal.id}:${patternId}`;
      await manager.query(
        `INSERT INTO economy.coin_ledger_entries
           (principal_type, principal_id, amount, reason, source_key, granted, metadata)
         VALUES ($1, $2, $3, $4, $5, true, $6)
         ON CONFLICT ON CONSTRAINT "UQ_coin_ledger_entries_source_key" DO NOTHING`,
        [
          principal.type,
          principal.id,
          -price,
          CoinLedgerReason.UnlockSpend,
          sourceKey,
          { patternId, tier, price },
        ],
      );

      // 4. Update balance (debit is a negative amount)
      const updatedBalanceRows = returningRows<BalanceRow>(
        await manager.query(
          `INSERT INTO economy.coin_balances (principal_type, principal_id, balance)
           VALUES ($1, $2, $3)
           ON CONFLICT ON CONSTRAINT "PK_coin_balances"
             DO UPDATE SET balance = economy.coin_balances.balance + EXCLUDED.balance,
                           updated_at = now()
           RETURNING balance`,
          [principal.type, principal.id, -price],
        ),
      );

      return {
        alreadyUnlocked: false,
        price,
        balance: Number(updatedBalanceRows[0].balance),
      };
    });
  }

  /**
   * List all unlocked pattern IDs for the given principal.
   */
  async listUnlockedPatternIds(
    principal: LedgerPrincipal,
  ): Promise<string[]> {
    const rows = await this.dataSource.query<{ pattern_id: string }[]>(
      `SELECT pattern_id
       FROM economy.pattern_unlocks
       WHERE principal_type = $1 AND principal_id = $2
       ORDER BY created_at`,
      [principal.type, principal.id],
    );
    return rows.map((r) => r.pattern_id);
  }

  /**
   * Check if a pattern is unlocked for the given principal.
   */
  async isPatternUnlocked(
    manager: EntityManager,
    principal: LedgerPrincipal,
    patternId: string,
  ): Promise<boolean> {
    const rows = await manager.query<{ unlocked: boolean }[]>(
      `SELECT EXISTS(
        SELECT 1 FROM economy.pattern_unlocks
        WHERE principal_type = $1 AND principal_id = $2 AND pattern_id = $3
      ) AS unlocked`,
      [principal.type, principal.id, patternId],
    );
    return rows[0]?.unlocked ?? false;
  }

  async getBalance(principal: LedgerPrincipal): Promise<number> {
    return this.readBalance(this.dataSource.manager, principal);
  }

  async getRewardDayStatus(
    principal: LedgerPrincipal,
    rewardDay: string,
  ): Promise<RewardDayPoolStatus> {
    const rows = await this.dataSource.query<readonly PoolRow[]>(
      `SELECT coins_consumed, ads_completed
       FROM economy.reward_day_pools
       WHERE principal_type = $1 AND principal_id = $2 AND reward_day = $3`,
      [principal.type, principal.id, rewardDay],
    );
    const pool = rows[0] ?? { coins_consumed: 0, ads_completed: 0 };
    return {
      adsCompleted: pool.ads_completed,
      coinsConsumed: pool.coins_consumed,
    };
  }

  private async replayExisting(
    manager: EntityManager,
    principal: LedgerPrincipal,
    rewardDay: string,
    sourceKey: string,
  ): Promise<AdRewardGrantResult> {
    const rows = await manager.query<readonly LedgerOutcomeRow[]>(
      `SELECT amount, granted
       FROM economy.coin_ledger_entries
       WHERE source_key = $1`,
      [sourceKey],
    );
    const outcome = rows[0] ?? { amount: '0', granted: false };
    const balance = await this.readBalance(manager, principal);
    const status = await this.readPoolStatus(manager, principal, rewardDay);
    return {
      granted: outcome.granted,
      amount: Number(outcome.amount),
      balance,
      adsCompleted: status.adsCompleted,
      coinsConsumed: status.coinsConsumed,
      replayed: true,
    };
  }

  private async readBalance(
    manager: EntityManager,
    principal: LedgerPrincipal,
  ): Promise<number> {
    const rows = await manager.query<readonly BalanceRow[]>(
      `SELECT balance
       FROM economy.coin_balances
       WHERE principal_type = $1 AND principal_id = $2`,
      [principal.type, principal.id],
    );
    return rows.length === 0 ? 0 : Number(rows[0].balance);
  }

  private async readPoolStatus(
    manager: EntityManager,
    principal: LedgerPrincipal,
    rewardDay: string,
  ): Promise<RewardDayPoolStatus> {
    const rows = await manager.query<readonly PoolRow[]>(
      `SELECT coins_consumed, ads_completed
       FROM economy.reward_day_pools
       WHERE principal_type = $1 AND principal_id = $2 AND reward_day = $3`,
      [principal.type, principal.id, rewardDay],
    );
    const pool = rows[0] ?? { coins_consumed: 0, ads_completed: 0 };
    return {
      adsCompleted: pool.ads_completed,
      coinsConsumed: pool.coins_consumed,
    };
  }
}
