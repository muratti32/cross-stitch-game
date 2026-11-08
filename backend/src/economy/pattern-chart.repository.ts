import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { returningRows } from '../database/query-results';
import { InsufficientCoinError } from './coin-ledger.repository';
import type { PatternChartTier } from './economy.constants';
import { CoinLedgerReason } from './entities';
import { paidDebitUpdateExpression } from './paid-reserve';

export interface PatternChartSpendResult {
  /** True when the entitlement already existed: nothing was charged. */
  alreadyEntitled: boolean;
  price: number;
  balance: number;
}

interface BalanceRow {
  balance: string | number;
}

/** Pattern Chart Entitlement persistence and the single Stitch Coin spend that buys one (ADR-0068). */
@Injectable()
export class PatternChartRepository {
  constructor(private readonly dataSource: DataSource) {}

  async isEntitled(accountId: string, patternId: string): Promise<boolean> {
    const rows = await this.dataSource.query<readonly { entitled: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM economy.pattern_chart_entitlements
         WHERE account_id = $1 AND pattern_id = $2
       ) AS entitled`,
      [accountId, patternId],
    );
    return rows[0]?.entitled === true;
  }

  async listPatternIds(accountId: string): Promise<string[]> {
    const rows = await this.dataSource.query<readonly { pattern_id: string }[]>(
      `SELECT pattern_id FROM economy.pattern_chart_entitlements
       WHERE account_id = $1 ORDER BY created_at`,
      [accountId],
    );
    return rows.map((row) => row.pattern_id);
  }

  async isPatternUnlocked(accountId: string, patternId: string): Promise<boolean> {
    const rows = await this.dataSource.query<readonly { unlocked: boolean }[]>(
      `SELECT EXISTS (
         SELECT 1 FROM economy.pattern_unlocks
         WHERE principal_type = 'account' AND principal_id = $1 AND pattern_id = $2
       ) AS unlocked`,
      [accountId, patternId],
    );
    return rows[0]?.unlocked === true;
  }

  /**
   * Claim the entitlement latch, then debit once under the ledger source key.
   * An insufficient balance throws and rolls the latch back, so a failed spend
   * never leaves an entitlement and a replay never charges twice.
   */
  async spend(
    accountId: string,
    patternId: string,
    price: number,
    tier: PatternChartTier,
  ): Promise<PatternChartSpendResult> {
    return this.dataSource.transaction(async (manager) => {
      const claim = returningRows<{ pattern_id: string }>(
        await manager.query(
          `INSERT INTO economy.pattern_chart_entitlements (account_id, pattern_id, source)
           VALUES ($1, $2, 'coin_spend')
           ON CONFLICT ON CONSTRAINT "PK_pattern_chart_entitlements" DO NOTHING
           RETURNING pattern_id`,
          [accountId, patternId],
        ),
      );
      if (claim.length === 0) {
        return { alreadyEntitled: true, price, balance: await this.readBalance(manager, accountId) };
      }

      const rows = await manager.query<readonly BalanceRow[]>(
        `SELECT balance FROM economy.coin_balances
         WHERE principal_type = 'account' AND principal_id = $1
         FOR UPDATE`,
        [accountId],
      );
      const balance = rows.length === 0 ? 0 : Number(rows[0].balance);
      if (balance < price) {
        throw new InsufficientCoinError(price, balance);
      }

      await manager.query(
        `INSERT INTO economy.coin_ledger_entries
           (principal_type, principal_id, amount, reason, source_key, granted, metadata)
         VALUES ('account', $1, $2, $3, $4, true, $5)
         ON CONFLICT ON CONSTRAINT "UQ_coin_ledger_entries_source_key" DO NOTHING`,
        [
          accountId,
          -price,
          CoinLedgerReason.PatternChartSpend,
          `pattern_chart:account:${accountId}:${patternId}`,
          { patternId, tier, price },
        ],
      );
      const updated = returningRows<BalanceRow>(
        await manager.query(
          `INSERT INTO economy.coin_balances (principal_type, principal_id, balance)
           VALUES ('account', $1, $2)
           ON CONFLICT ON CONSTRAINT "PK_coin_balances"
             DO UPDATE SET balance = economy.coin_balances.balance + EXCLUDED.balance,
                           paid_balance = ${paidDebitUpdateExpression('economy.coin_balances')},
                           updated_at = now()
           RETURNING balance`,
          [accountId, -price],
        ),
      );
      return { alreadyEntitled: false, price, balance: Number(updated[0].balance) };
    });
  }

  private async readBalance(manager: EntityManager, accountId: string): Promise<number> {
    const rows = await manager.query<readonly BalanceRow[]>(
      `SELECT balance FROM economy.coin_balances
       WHERE principal_type = 'account' AND principal_id = $1`,
      [accountId],
    );
    return rows.length === 0 ? 0 : Number(rows[0].balance);
  }
}
