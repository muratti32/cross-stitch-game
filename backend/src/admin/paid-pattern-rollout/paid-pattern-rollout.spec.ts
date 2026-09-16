import type { PatternPaidBulkResult } from '../pattern-paid-admin.service';
import {
  parseRolloutArgs,
  runPaidPatternRollout,
  type PaidPatternRolloutClient,
  type PaidPatternRolloutDependencies,
  type PaidPatternRolloutOptions,
  type PaidPatternRolloutReport,
} from './paid-pattern-rollout';
import { selectPaidPatterns, type PaidPatternCandidate } from './paid-pattern-selection';

function fixture(): PaidPatternCandidate[] {
  return Array.from({ length: 10 }, (_, category) =>
    Array.from({ length: 19 }, (__, index): PaidPatternCandidate => ({
      categoryCode: `category-${String(category).padStart(2, '0')}`,
      id: `${String(category).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`,
      patternType: 'official',
      status: 'available',
      stitchableCellCount: index < 2 ? 3_000 : 5_000,
      title: `Pattern ${category}-${index}`,
      unlockPriceTier: null,
    })),
  ).flat();
}

function options(overrides: Partial<PaidPatternRolloutOptions> = {}): PaidPatternRolloutOptions {
  return {
    apiUrl: 'https://admin.example.test/path',
    apply: false,
    credentials: {
      email: 'operator@example.com',
      password: 'password',
      totpCode: '123456',
    },
    envLabel: 'staging',
    revert: false,
    seed: 'rollout-seed',
    ...overrides,
  };
}

function successfulResults(patternIds: string[]): PatternPaidBulkResult[] {
  return patternIds.map((patternId) => ({
    afterTier: 'medium',
    beforeTier: null,
    grandfatheredCount: 1,
    outcome: 'changed',
    patternId,
  }));
}

function harness(): {
  client: jest.Mocked<PaidPatternRolloutClient>;
  deps: PaidPatternRolloutDependencies;
  output: jest.Mock<void, [string]>;
  reportWriter: jest.Mock<Promise<void>, [string, PaidPatternRolloutReport]>;
} {
  const client: jest.Mocked<PaidPatternRolloutClient> = {
    bulkSetPaid: jest.fn(
      (patternIds: string[], paid: boolean, requestId: string) => {
        void paid;
        void requestId;
        return Promise.resolve({
          paid: true,
          results: successfulResults(patternIds),
        });
      },
    ),
    getStaffPicks: jest.fn().mockResolvedValue([]),
    listPatterns: jest.fn().mockResolvedValue(fixture()),
    login: jest.fn().mockResolvedValue(undefined),
  };
  const output = jest.fn<void, [string]>();
  const reportWriter = jest.fn<Promise<void>, [string, PaidPatternRolloutReport]>()
    .mockResolvedValue(undefined);
  return {
    client,
    deps: {
      client,
      clock: () => new Date('2026-09-16T12:00:00.000Z'),
      output,
      reportWriter,
    },
    output,
    reportWriter,
  };
}

describe('parseRolloutArgs', () => {
  const env = {
    ADMIN_API_URL: 'https://admin.example.test',
    ADMIN_EMAIL: 'operator@example.com',
    ADMIN_PASSWORD: 'password',
    ADMIN_TOTP_SECRET: 'secret',
  };

  it('parses dry-run arguments and environment credentials', () => {
    expect(parseRolloutArgs(['--seed', 'seed', '--env-label', 'staging'], env)).toEqual({
      apiUrl: 'https://admin.example.test',
      apply: false,
      confirmDigest: undefined,
      credentials: {
        email: 'operator@example.com',
        password: 'password',
        totpCode: undefined,
        totpSecret: 'secret',
      },
      envLabel: 'staging',
      reportPath: undefined,
      revert: false,
      seed: 'seed',
    });
  });

  it.each([
    [[], 'seed'],
    [['--seed', 'seed'], 'env-label'],
    [['--seed', 'seed', '--env-label', 'staging', '--unknown'], 'Unknown'],
    [['--seed', 'seed', '--env-label', 'staging', '--apply'], 'confirm-digest'],
    [['--seed', 'seed', '--env-label', 'staging', '--confirm-digest', 'invalid'], '64-character'],
    [
      ['--seed', 'seed', '--env-label', 'staging', '--apply', '--confirm-digest', 'a'.repeat(64)],
      '--report is required',
    ],
    [['--seed', 'seed', '--env-label', 'staging', '--revert'], '--revert requires --apply'],
  ])('rejects invalid arguments', (argv, message) => {
    expect(() => parseRolloutArgs(argv, env)).toThrow(message);
  });

  it('rejects missing credentials', () => {
    expect(() => parseRolloutArgs(
      ['--seed', 'seed', '--env-label', 'staging'],
      { ADMIN_API_URL: 'https://admin.example.test' },
    )).toThrow('ADMIN_EMAIL');
  });
});

describe('runPaidPatternRollout', () => {
  it('dry-run prints and reports without calling bulk paid', async () => {
    const { client, deps, reportWriter } = harness();

    await expect(runPaidPatternRollout(
      options({ reportPath: 'report.json' }),
      deps,
    )).resolves.toBe(0);

    expect(client.bulkSetPaid).not.toHaveBeenCalled();
    expect(reportWriter).toHaveBeenCalledWith(
      'report.json',
      expect.objectContaining({ apiUrl: 'https://admin.example.test/path', mode: 'dry-run' }),
    );
  });

  it('reverts the same selection to free with its own request IDs', async () => {
    const { client, deps, reportWriter } = harness();
    const selection = selectPaidPatterns({
      candidates: fixture(),
      seed: 'rollout-seed',
      staffPickPatternIds: [],
    });

    await expect(runPaidPatternRollout(
      options({
        apply: true,
        confirmDigest: selection.selectionDigest,
        reportPath: 'revert.json',
        revert: true,
      }),
      deps,
    )).resolves.toBe(0);

    expect(client.bulkSetPaid).toHaveBeenNthCalledWith(
      1,
      selection.selectedPatternIds.slice(0, 50),
      false,
      `free-rollout-${selection.selectionDigest.slice(0, 12)}-b0`,
    );
    expect(reportWriter).toHaveBeenCalledWith(
      'revert.json',
      expect.objectContaining({ mode: 'revert' }),
    );
  });

  it.each([
    ['missing', undefined],
    ['mismatched', '0'.repeat(64)],
  ])('refuses apply with a %s digest before bulk paid', async (_name, confirmDigest) => {
    const { client, deps } = harness();

    await expect(runPaidPatternRollout(
      options({ apply: true, confirmDigest }),
      deps,
    )).resolves.toBe(1);
    expect(client.bulkSetPaid).not.toHaveBeenCalled();
  });

  it('chunks 60 sorted ids into 50 and 10 with stable request IDs', async () => {
    const { client, deps } = harness();
    const selection = selectPaidPatterns({
      candidates: fixture(),
      seed: 'rollout-seed',
      staffPickPatternIds: [],
    });
    const prefix = `paid-rollout-${selection.selectionDigest.slice(0, 12)}`;

    await expect(runPaidPatternRollout(
      options({ apply: true, confirmDigest: selection.selectionDigest }),
      deps,
    )).resolves.toBe(0);

    expect(client.bulkSetPaid).toHaveBeenCalledTimes(2);
    // Re-authenticated before the second batch so a long apply cannot 401.
    expect(client.login).toHaveBeenCalledTimes(2);
    expect(client.bulkSetPaid).toHaveBeenNthCalledWith(
      1,
      selection.selectedPatternIds.slice(0, 50),
      true,
      `${prefix}-b0`,
    );
    expect(client.bulkSetPaid).toHaveBeenNthCalledWith(
      2,
      selection.selectedPatternIds.slice(50),
      true,
      `${prefix}-b1`,
    );
  });

  it('returns non-zero and lists a failed result', async () => {
    const { client, deps, output } = harness();
    const selection = selectPaidPatterns({
      candidates: fixture(),
      seed: 'rollout-seed',
      staffPickPatternIds: [],
    });
    client.bulkSetPaid.mockImplementation((patternIds) => Promise.resolve({
      paid: true,
      results: patternIds.map((patternId, index) => index === 0
        ? { errorCode: 'pattern_not_eligible', outcome: 'failed', patternId }
        : successfulResults([patternId])[0]),
    }));

    await expect(runPaidPatternRollout(
      options({ apply: true, confirmDigest: selection.selectionDigest }),
      deps,
    )).resolves.toBe(1);
    expect(output).toHaveBeenCalledWith(expect.stringContaining('pattern_not_eligible'));
  });

  it('writes a partial report when a later batch throws', async () => {
    const { client, deps, reportWriter } = harness();
    const selection = selectPaidPatterns({
      candidates: fixture(),
      seed: 'rollout-seed',
      staffPickPatternIds: [],
    });
    client.bulkSetPaid
      .mockResolvedValueOnce({
        paid: true,
        results: successfulResults(selection.selectedPatternIds.slice(0, 50)),
      })
      .mockRejectedValueOnce(new Error('second batch failed'));

    await expect(runPaidPatternRollout(
      options({
        apply: true,
        confirmDigest: selection.selectionDigest,
        reportPath: 'partial.json',
      }),
      deps,
    )).resolves.toBe(1);

    expect(reportWriter.mock.calls[0]?.[0]).toBe('partial.json');
    const partialReport = reportWriter.mock.calls[0]?.[1];
    expect(partialReport?.apply?.error).toBe('second batch failed');
    expect(partialReport?.apply?.requestIds).toHaveLength(2);
    expect(partialReport?.apply?.requestIds[0]).toMatch(/-b0$/);
    expect(partialReport?.apply?.requestIds[1]).toMatch(/-b1$/);
    expect(partialReport?.apply?.results[0]?.patternId)
      .toBe(selection.selectedPatternIds[0]);
  });
});
