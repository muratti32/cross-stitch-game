import type { DataSource } from 'typeorm';

import type { LedgerPrincipal } from '../../src/economy/coin-ledger.repository';
import type { PromotionMode, PromotionPackageStatus } from '../../src/promotion/entities';

interface LedgerEntry {
  id: string;
  principal_type: LedgerPrincipal['type'];
  principal_id: string;
  amount: string;
  granted: boolean;
  source_key: string;
}

interface Pool {
  coins_consumed: number;
  ads_completed: number;
  premium_claimed: boolean;
}

interface Attempt {
  owner: LedgerPrincipal;
  consumed: boolean;
  expired: boolean;
}

interface PromotionPackage {
  account_id: string;
  promotion_mode: PromotionMode | null;
  status: PromotionPackageStatus;
}

const key = (type: string, id: string) => `${type}:${id}`;

/**
 * In-memory stand-in for the tables the rewarded-ad grant path reads and
 * writes. It answers the exact statements CoinLedgerRepository and
 * AdAttemptRepository issue and throws on anything else, so a new statement
 * fails the test instead of silently returning nothing.
 */
export function createAdRewardLedgerFake() {
  const entries: LedgerEntry[] = [];
  const balances = new Map<string, number>();
  const pools = new Map<string, Pool>();
  const attempts = new Map<string, Attempt>();
  const packages = new Map<string, PromotionPackage>();
  const statements: string[] = [];

  const pool = (type: string, id: string, day: string): Pool => {
    const k = `${key(type, id)}:${day}`;
    let row = pools.get(k);
    if (!row) {
      row = { coins_consumed: 0, ads_completed: 0, premium_claimed: false };
      pools.set(k, row);
    }
    return row;
  };

  function answer(sql: string, params: unknown[]): unknown {
    const s = sql.replace(/\s+/g, ' ').trim();
    statements.push(s);
    const p = params as string[];

    if (s.startsWith('SELECT account_id, promotion_mode, status FROM promotion.transfer_packages')) {
      const pkg = packages.get(p[0]);
      return pkg ? [pkg] : [];
    }
    if (s.startsWith('UPDATE economy.ad_attempts SET consumed_at = now()')) {
      const attempt = attempts.get(p[0]);
      if (!attempt || attempt.consumed || attempt.expired) return [[], 0];
      attempt.consumed = true;
      return [[{ principal_type: attempt.owner.type, principal_id: attempt.owner.id }], 1];
    }
    if (s.startsWith('INSERT INTO economy.coin_ledger_entries') && s.includes('RETURNING id')) {
      if (entries.some((e) => e.source_key === p[3])) return [];
      const id = `entry-${entries.length + 1}`;
      entries.push({ id, principal_type: p[0] as LedgerPrincipal['type'], principal_id: p[1], amount: '0', granted: false, source_key: p[3] });
      return [{ id }];
    }
    if (s.startsWith('INSERT INTO economy.reward_day_pools')) {
      pool(p[0], p[1], p[2]);
      return [];
    }
    if (s.startsWith('SELECT coins_consumed, ads_completed, premium_claimed FROM economy.reward_day_pools')) {
      const row = pools.get(`${key(p[0], p[1])}:${p[2]}`);
      return row ? [{ ...row }] : [];
    }
    if (s.startsWith('UPDATE economy.reward_day_pools SET coins_consumed = coins_consumed +')) {
      const row = pool(p[0], p[1], p[2]);
      row.coins_consumed += Number(params[3]);
      row.ads_completed += 1;
      return [[{ ...row }], 1];
    }
    if (s.startsWith('INSERT INTO economy.coin_balances') && s.includes('RETURNING balance')) {
      const k = key(p[0], p[1]);
      const balance = (balances.get(k) ?? 0) + Number(params[2]);
      balances.set(k, balance);
      return [{ balance: String(balance) }];
    }
    if (s.startsWith('UPDATE economy.coin_ledger_entries SET amount = $2, granted = true')) {
      const entry = entries.find((e) => e.id === p[0]);
      if (entry) Object.assign(entry, { amount: String(params[1]), granted: true });
      return [[], 1];
    }
    if (s.startsWith('UPDATE economy.coin_ledger_entries SET metadata = $2')) {
      return [[], 1];
    }
    if (s.startsWith('SELECT balance FROM economy.coin_balances')) {
      const balance = balances.get(key(p[0], p[1]));
      return balance === undefined ? [] : [{ balance: String(balance) }];
    }
    if (s.startsWith('SELECT principal_type, principal_id, granted, amount FROM economy.coin_ledger_entries')) {
      return entries.filter((e) => e.source_key === p[0]);
    }
    throw new Error(`ad reward ledger fake: unhandled statement: ${s}`);
  }

  const query = (sql: string, params: unknown[] = []): Promise<unknown> =>
    new Promise((resolve) => resolve(answer(sql, params)));
  const manager = { query };
  const dataSource = {
    query,
    manager,
    transaction: async <T>(work: (m: typeof manager) => Promise<T>): Promise<T> => work(manager),
  } as unknown as DataSource;

  return {
    dataSource,
    statements,
    openAttempt(nonce: string, owner: LedgerPrincipal) {
      attempts.set(nonce, { owner, consumed: false, expired: false });
    },
    commitPromotion(guestId: string, accountId: string, mode: PromotionMode, status: PromotionPackageStatus = 'committed') {
      packages.set(guestId, { account_id: accountId, promotion_mode: mode, status });
    },
    balanceOf(owner: LedgerPrincipal): number {
      return balances.get(key(owner.type, owner.id)) ?? 0;
    },
    adsCompletedOf(owner: LedgerPrincipal, rewardDay: string): number {
      return pools.get(`${key(owner.type, owner.id)}:${rewardDay}`)?.ads_completed ?? 0;
    },
    entryFor(sourceKey: string): LedgerEntry | undefined {
      return entries.find((e) => e.source_key === sourceKey);
    },
  };
}
