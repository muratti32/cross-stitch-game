import { ConflictException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { EconomyGuestPurgeRepository } from '../economy/economy-guest-purge.repository';
import { GuestInstallationsRepository } from './guest-installations.repository';

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface PurgeHarness {
  repository: GuestInstallationsRepository;
  queries: RecordedQuery[];
  purged: string[];
  economyPurge: EconomyGuestPurgeRepository;
}

function createHarness(status: string): PurgeHarness {
  const queries: RecordedQuery[] = [];
  const purged: string[] = [];
  const manager = {
    query: jest.fn((sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      return Promise.resolve(
        sql.includes('SELECT status FROM auth.guest_installations') ? [{ status }] : [],
      );
    }),
  };
  const dataSource = {
    transaction: jest.fn((...args: unknown[]) => {
      const work = args[args.length - 1] as (value: typeof manager) => unknown;
      return Promise.resolve(work(manager));
    }),
  } as unknown as DataSource;

  const record = (context: string) =>
    jest.fn((_manager: EntityManager, guestInstallationId: string) => {
      purged.push(`${context}:${guestInstallationId}`);
      return Promise.resolve();
    });
  const economyPurge = {
    assertNoUnresolvedPurchaseAttempt: jest.fn(() => Promise.resolve()),
    purgeGuest: record('economy'),
  } as unknown as EconomyGuestPurgeRepository;

  return {
    economyPurge,
    purged,
    queries,
    repository: new GuestInstallationsRepository(
      dataSource,
      economyPurge,
      { purgeGuest: record('ai') },
      { purgeGuest: record('conversion') },
      { purgeGuest: record('catalog') },
      { purgeGuest: record('sessions') },
    ),
  };
}

describe('GuestInstallationsRepository reset', () => {
  it('lets every bounded context erase its own Guest rows in one transaction', async () => {
    const harness = createHarness('active');

    await harness.repository.reset('guest-1');

    expect(harness.purged).toEqual([
      'economy:guest-1',
      'ai:guest-1',
      'conversion:guest-1',
      'catalog:guest-1',
      'sessions:guest-1',
    ]);
    // The auth module writes only its own schema.
    const ownSql = harness.queries.map(({ sql }) => sql).join('\n');
    expect(ownSql).toContain('UPDATE auth.guest_installations');
    expect(ownSql).toContain('UPDATE auth.refresh_tokens');
    expect(ownSql).not.toMatch(/economy\.|ai\.|conversion\.|catalog\.|sessions\./);
  });

  it('refuses the reset while a Purchase Attempt is unresolved', async () => {
    const harness = createHarness('active');
    jest
      .spyOn(harness.economyPurge, 'assertNoUnresolvedPurchaseAttempt')
      .mockRejectedValue(new ConflictException('unresolved'));

    await expect(harness.repository.reset('guest-1')).rejects.toBeInstanceOf(ConflictException);
    expect(harness.purged).toEqual([]);
    expect(harness.queries.some(({ sql }) => sql.startsWith('UPDATE'))).toBe(false);
  });

  it('skips the Purchase Attempt gate for an already revoked installation', async () => {
    const harness = createHarness('revoked');

    await harness.repository.reset('guest-1');

    expect(harness.economyPurge.assertNoUnresolvedPurchaseAttempt).not.toHaveBeenCalled();
    expect(harness.purged).toHaveLength(5);
  });
});
