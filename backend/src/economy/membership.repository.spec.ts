import { DataSource } from 'typeorm';

import { MembershipRepository } from './membership.repository';

describe('MembershipRepository Guest ownership', () => {
  it('uses a Guest principal and collision-free daily source key', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params: params ?? [] });
        if (sql.includes('FROM economy.coin_ledger_entries')) return [];
        if (sql.includes('FROM economy.membership_periods')) {
          return [{ plan: 'monthly', current_status: 'active', ends_at: new Date(Date.now() + 86_400_000), status_event_at: new Date() }];
        }
        if (sql.includes('RETURNING id, amount')) return [{ id: 'claim-1', amount: '0' }];
        if (sql.includes('FROM economy.reward_day_pools')) return [{ coins_consumed: 0, ads_completed: 0, premium_claimed: false }];
        if (sql.includes('RETURNING balance')) return [{ balance: '30' }];
        return [];
      }),
    };
    const dataSource = {
      manager,
      transaction: jest.fn(async (...args: unknown[]) => {
        const work = args[args.length - 1] as (value: typeof manager) => unknown;
        return work(manager);
      }),
    } as unknown as DataSource;
    const repository = new MembershipRepository(dataSource);

    await repository.claimPremiumDailyCoin(
      { type: 'guest', guestInstallationId: '22222222-2222-4222-8222-222222222222' },
      '2026-08-22',
    );

    const claimInsert = queries.find((query) => query.sql.includes('INSERT INTO economy.coin_ledger_entries'));
    expect(claimInsert?.params).toEqual([
      'guest',
      '22222222-2222-4222-8222-222222222222',
      'premium_daily_claim',
      'premium_daily:guest:22222222-2222-4222-8222-222222222222:2026-08-22',
    ]);
  });
});
