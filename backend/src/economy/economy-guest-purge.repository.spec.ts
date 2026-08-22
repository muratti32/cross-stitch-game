import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { EconomyGuestPurgeRepository } from './economy-guest-purge.repository';

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function createManager(respond: (sql: string) => unknown[]): {
  manager: EntityManager;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const manager = {
    query: jest.fn((sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return Promise.resolve(respond(sql));
    }),
  } as unknown as EntityManager;
  return { manager, queries };
}

describe('EconomyGuestPurgeRepository', () => {
  it('tombstones provider grants and claimed reward days before erasing the ledger', async () => {
    const { manager, queries } = createManager(() => []);

    await new EconomyGuestPurgeRepository().purgeGuest(manager, 'guest-1');

    const tombstones = queries.filter(({ sql }) =>
      sql.includes('INSERT INTO economy.commerce_grant_tombstones'));
    expect(tombstones).toHaveLength(2);
    // Store transactions first, then the reward days those subscriptions paid for.
    expect(tombstones[0].sql).toContain("source_key LIKE 'commerce:%'");
    expect(tombstones[0].sql).toContain("source_key LIKE 'membership:%'");
    expect(tombstones[1].sql).toContain('premium_daily:');
    expect(tombstones[1].sql).toContain('economy.membership_periods');
    expect(tombstones[0].params).toEqual(['guest-1']);

    const tombstoneIndexes = queries
      .map(({ sql }, index) => ({ index, sql }))
      .filter(({ sql }) => sql.includes('commerce_grant_tombstones'))
      .map(({ index }) => index);
    const ledgerDelete = queries.findIndex(({ sql }) =>
      sql.startsWith('DELETE FROM economy.coin_ledger_entries'));
    expect(ledgerDelete).toBeGreaterThan(Math.max(...tombstoneIndexes));
  });

  it('erases balances, content, and ordinary Guest records', async () => {
    const { manager, queries } = createManager(() => []);

    await new EconomyGuestPurgeRepository().purgeGuest(manager, 'guest-1');

    const deleted = queries
      .map(({ sql }) => /DELETE FROM (economy\.\w+)/.exec(sql)?.[1])
      .filter((table): table is string => table !== undefined);
    expect(deleted).toEqual([
      'economy.membership_events',
      'economy.membership_periods',
      'economy.premium_purchase_reconciliations',
      'economy.purchase_attempts',
      'economy.revenuecat_subscriber_mappings',
      'economy.coin_ledger_entries',
      'economy.ai_credit_ledger_entries',
      'economy.coin_balances',
      'economy.ai_credit_balances',
      'economy.reward_day_pools',
      'economy.gameplay_events',
      'economy.daily_color_action_counts',
      'economy.ad_attempts',
      'economy.pattern_unlocks',
    ]);
  });

  it('refuses the reset while a Purchase Attempt is unresolved', async () => {
    const { manager } = createManager((sql) =>
      sql.includes('FROM economy.purchase_attempts') ? [{ id: 'attempt-1' }] : []);

    await expect(
      new EconomyGuestPurgeRepository().assertNoUnresolvedPurchaseAttempt(manager, 'guest-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows the reset once no Purchase Attempt is outstanding', async () => {
    const { manager } = createManager(() => []);

    await expect(
      new EconomyGuestPurgeRepository().assertNoUnresolvedPurchaseAttempt(manager, 'guest-1'),
    ).resolves.toBeUndefined();
  });
});
