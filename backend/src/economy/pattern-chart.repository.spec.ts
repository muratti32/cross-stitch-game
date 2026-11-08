import { InsufficientCoinError } from './coin-ledger.repository';
import { grantPatternChartEntitlement } from './pattern-chart-entitlement';
import { PatternChartRepository } from './pattern-chart.repository';

const accountId = '11111111-1111-4111-8111-111111111111';
const patternId = '44444444-4444-4444-8444-444444444444';

function harness(query: jest.Mock) {
  const manager = { query };
  const dataSource = {
    query,
    transaction: jest.fn((callback: (tx: typeof manager) => unknown) => Promise.resolve(callback(manager))),
  };
  return new PatternChartRepository(dataSource as never);
}

describe('PatternChartRepository.spend', () => {
  it('claims the latch, debits once under the pattern_chart source key and returns the new balance', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ balance: '50' }]) // lock balance first (same order as completion)
      .mockResolvedValueOnce([{ pattern_id: patternId }]) // latch
      .mockResolvedValueOnce([]) // ledger
      .mockResolvedValueOnce([{ balance: '30' }]); // balance update
    const repo = harness(query);

    await expect(repo.spend(accountId, patternId, 20, 'small')).resolves.toEqual({
      alreadyEntitled: false,
      price: 20,
      balance: 30,
    });
    const calls = query.mock.calls as [string, unknown[]][];
    expect(calls[0][0]).toContain('FOR UPDATE');
    expect(calls[1][0]).toContain('pattern_chart_entitlements');
    const ledger = calls[2];
    expect(ledger[0]).toContain('coin_ledger_entries');
    expect(ledger[1]).toEqual([
      accountId,
      -20,
      'pattern_chart_spend',
      `pattern_chart:account:${accountId}:${patternId}`,
      { patternId, tier: 'small', price: 20 },
    ]);
    expect(calls[3][1]).toEqual([accountId, -20]);
  });

  it('does not charge when the latch already exists', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ balance: '50' }]) // lock balance
      .mockResolvedValueOnce([]); // latch conflict
    const repo = harness(query);

    await expect(repo.spend(accountId, patternId, 20, 'small')).resolves.toEqual({
      alreadyEntitled: true,
      price: 20,
      balance: 50,
    });
    expect(query.mock.calls.flat().join(' ')).not.toContain('coin_ledger_entries');
  });

  it.each([['5'], ['-10']])('throws InsufficientCoinError for balance %s before any debit', async (balance) => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ balance }])
      .mockResolvedValueOnce([{ pattern_id: patternId }]);
    const repo = harness(query);

    await expect(repo.spend(accountId, patternId, 20, 'small')).rejects.toEqual(
      new InsufficientCoinError(20, Number(balance)),
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not throw for an already-entitled replay even with a low balance', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ balance: '1' }]).mockResolvedValueOnce([]);
    await expect(harness(query).spend(accountId, patternId, 20, 'small')).resolves.toMatchObject({ alreadyEntitled: true, balance: 1 });
  });

  it('treats a missing balance row as zero', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ pattern_id: patternId }]);
    const repo = harness(query);

    await expect(repo.spend(accountId, patternId, 20, 'small')).rejects.toBeInstanceOf(InsufficientCoinError);
  });
});

describe('PatternChartRepository reads', () => {
  it('reports entitlement and unlock existence', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ entitled: true }])
      .mockResolvedValueOnce([{ unlocked: false }])
      .mockResolvedValueOnce([{ pattern_id: 'a' }, { pattern_id: 'b' }]);
    const repo = harness(query);

    await expect(repo.isEntitled(accountId, patternId)).resolves.toBe(true);
    await expect(repo.isPatternUnlocked(accountId, patternId)).resolves.toBe(false);
    await expect(repo.listPatternIds(accountId)).resolves.toEqual(['a', 'b']);
  });
});

describe('grantPatternChartEntitlement', () => {
  it('only inserts for Official catalog Patterns and reports eligibility', async () => {
    const query = jest.fn().mockResolvedValue([{ eligible: true }]);

    await expect(grantPatternChartEntitlement({ query } as never, accountId, patternId, 'completion')).resolves.toBe(true);

    const calls = query.mock.calls as [string, unknown[]][];
    expect(calls[0][0]).toContain("visibility = 'catalog' AND creator_profile_id IS NULL");
    expect(calls[0][0]).toContain('DO NOTHING');
    expect(calls[0][1]).toEqual([accountId, patternId, 'completion']);
  });

  it('reports false for a non-Official Pattern', async () => {
    const query = jest.fn().mockResolvedValue([{ eligible: false }]);

    await expect(grantPatternChartEntitlement({ query } as never, accountId, patternId, 'promotion')).resolves.toBe(false);
  });
});
