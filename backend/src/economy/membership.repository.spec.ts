import { DataSource } from 'typeorm';

import { MembershipRepository } from './membership.repository';

describe('MembershipRepository Guest ownership', () => {
  it('restores only Premium ownership from a finalized account', async () => {
    const queries: string[] = [];
    const manager = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT DISTINCT account_id')) {
          return [{ account_id: 'account-deleted', guest_installation_id: null }];
        }
        if (sql.includes('FROM auth.registered_accounts')) return [{ id: 'account-deleted' }];
        if (sql.includes('RETURNING provider_event_id')) return [];
        if (sql.includes('FROM economy.membership_events')) {
          return [{
            environment: 'production',
            provider_event_id: 'event-1',
            provider_transaction_id: 'transaction-1',
            original_transaction_id: 'original-1',
            account_id: null,
            guest_installation_id: 'guest-restored',
            event_type: 'INITIAL_PURCHASE',
            product_id: 'com.avk.stitchwish.premium_monthly',
            period_type: 'PAID',
            event_at: new Date(),
            purchased_at: new Date(),
            expires_at: new Date(Date.now() + 86_400_000),
            grace_period_expires_at: null,
            cancel_reason: null,
          }];
        }
        if (sql.includes('SELECT id FROM economy.ai_credit_ledger_entries')) return [{ id: 'old-grant' }];
        return [];
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (...args: unknown[]) => {
        const work = args[args.length - 1] as (value: typeof manager) => unknown;
        return work(manager);
      }),
    } as unknown as DataSource;
    const repository = new MembershipRepository(dataSource);

    const result = await repository.recordVerifiedEvent({
      environment: 'production',
      providerEventId: 'event-1',
      providerTransactionId: 'transaction-1',
      originalTransactionId: 'original-1',
      owner: { type: 'guest', guestInstallationId: 'guest-restored' },
      type: 'INITIAL_PURCHASE',
      productId: 'com.avk.stitchwish.premium_monthly',
      periodType: 'PAID',
      eventAt: new Date(),
      purchasedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      gracePeriodExpiresAt: null,
      cancelReason: null,
    });

    expect(result.rejectedOtherAccount).toBe(false);
    expect(queries.some((sql) => sql.includes('UPDATE economy.membership_events'))).toBe(true);
    expect(queries.some((sql) => sql.includes('UPDATE economy.membership_periods'))).toBe(true);
  });

  it('withholds the Membership Credit grant once a reset tombstoned its source key', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params: params ?? [] });
        if (sql.includes('FROM economy.commerce_grant_tombstones')) {
          return [{ source_key: 'membership:production:transaction-1' }];
        }
        if (sql.includes('RETURNING provider_event_id')) return [{ provider_event_id: 'event-1' }];
        if (sql.includes('SELECT *') && sql.includes('FROM economy.membership_events')) {
          return [{
            environment: 'production',
            provider_event_id: 'event-1',
            provider_transaction_id: 'transaction-1',
            original_transaction_id: 'original-1',
            account_id: null,
            guest_installation_id: 'guest-fresh',
            event_type: 'INITIAL_PURCHASE',
            product_id: 'com.avk.stitchwish.premium_monthly',
            period_type: 'PAID',
            event_at: new Date(),
            purchased_at: new Date(),
            expires_at: new Date(Date.now() + 86_400_000),
            grace_period_expires_at: null,
            cancel_reason: null,
          }];
        }
        return [];
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (...args: unknown[]) => {
        const work = args[args.length - 1] as (value: typeof manager) => unknown;
        return work(manager);
      }),
    } as unknown as DataSource;
    const repository = new MembershipRepository(dataSource);

    const result = await repository.recordVerifiedEvent({
      environment: 'production',
      providerEventId: 'event-1',
      providerTransactionId: 'transaction-1',
      originalTransactionId: 'original-1',
      owner: { type: 'guest', guestInstallationId: 'guest-fresh' },
      type: 'INITIAL_PURCHASE',
      productId: 'com.avk.stitchwish.premium_monthly',
      periodType: 'PAID',
      eventAt: new Date(),
      purchasedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      gracePeriodExpiresAt: null,
      cancelReason: null,
    });

    // The restored subscription still exists for the fresh Guest, but the
    // Membership Credit that the erased identity already received is gone.
    expect(result.periodExists).toBe(true);
    expect(result.creditGranted).toBe(0);
    expect(queries.some(({ sql }) =>
      sql.includes('INSERT INTO economy.ai_credit_ledger_entries'))).toBe(false);
    expect(queries.some(({ sql, params }) =>
      sql.includes('FROM economy.commerce_grant_tombstones')
      && params[0] === 'membership:production:transaction-1')).toBe(true);
  });

  it('uses a Guest principal and collision-free daily source key', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params: params ?? [] });
        if (sql.includes('FROM economy.coin_ledger_entries')) return [];
        // No reward day of this subscription has been tombstoned by a reset.
        if (sql.includes('economy.commerce_grant_tombstones')) return [];
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

  it('replays instead of re-claiming a reward day tombstoned by an earlier reset', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params: params ?? [] });
        if (sql.includes('economy.commerce_grant_tombstones')) {
          return Promise.resolve([{
            source_key: 'premium_daily:production:transaction-1:2026-08-22',
          }]);
        }
        if (sql.includes('FROM economy.membership_periods')) {
          return Promise.resolve([{
            plan: 'monthly',
            current_status: 'active',
            ends_at: new Date(Date.now() + 86_400_000),
            status_event_at: new Date(),
          }]);
        }
        if (sql.includes('FROM economy.reward_day_pools')) {
          return Promise.resolve([{ coins_consumed: 0, ads_completed: 0, premium_claimed: false }]);
        }
        return Promise.resolve([]);
      }),
    };
    const dataSource = {
      manager,
      transaction: jest.fn((...args: unknown[]) => {
        const work = args[args.length - 1] as (value: typeof manager) => unknown;
        return Promise.resolve(work(manager));
      }),
    } as unknown as DataSource;
    const repository = new MembershipRepository(dataSource);

    const result = await repository.claimPremiumDailyCoin(
      { type: 'guest', guestInstallationId: '33333333-3333-4333-8333-333333333333' },
      '2026-08-22',
    );

    // The restored Premium Membership stays active; the reward day its erased
    // identity already claimed does not pay out a second time.
    expect(result.replayed).toBe(true);
    expect(result.amount).toBe(0);
    expect(queries.some(({ sql }) =>
      sql.includes('INSERT INTO economy.coin_ledger_entries'))).toBe(false);
  });
});
