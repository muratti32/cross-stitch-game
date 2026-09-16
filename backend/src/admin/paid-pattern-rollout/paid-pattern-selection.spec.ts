import {
  PaidPatternSelectionError,
  selectPaidPatterns,
  type PaidPatternCandidate,
} from './paid-pattern-selection';

function productionFixture(): {
  candidates: PaidPatternCandidate[];
  staffPickPatternIds: string[];
} {
  const candidates: PaidPatternCandidate[] = [];
  const staffPickPatternIds: string[] = [];
  for (let category = 0; category < 10; category += 1) {
    for (let index = 0; index < 19; index += 1) {
      const id = `${String(category).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`;
      candidates.push({
        categoryCode: `category-${String(category).padStart(2, '0')}`,
        id,
        patternType: 'official',
        status: 'available',
        stitchableCellCount: index < 2 ? 3_000 : 5_000,
        title: `Pattern ${category}-${index}`,
        unlockPriceTier: null,
      });
      if (index < 5) staffPickPatternIds.push(id);
    }
  }
  return { candidates, staffPickPatternIds };
}

function candidates(count: number, overrides: Partial<PaidPatternCandidate> = {}): PaidPatternCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    categoryCode: 'animals',
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    patternType: 'official',
    status: 'available',
    stitchableCellCount: 1_000,
    title: `Pattern ${index}`,
    unlockPriceTier: null,
    ...overrides,
  }));
}

function expectSelectionError(code: string, operation: () => unknown): void {
  try {
    operation();
    throw new Error('Expected selection to throw');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(PaidPatternSelectionError);
    if (error instanceof PaidPatternSelectionError) expect(error.code).toBe(code);
  }
}

describe('selectPaidPatterns', () => {
  it('selects the production rollout shape within every constraint', () => {
    const fixture = productionFixture();
    const result = selectPaidPatterns({ ...fixture, seed: 'production-seed' });

    expect(result.totalPaid).toBe(60);
    expect(result.perCategory).toHaveLength(10);
    expect(result.perCategory.every((row) => row.paid === 6 && row.usable === 19)).toBe(true);
    expect(result.perTier.small).toBeGreaterThanOrEqual(6);
    expect(result.perTier.small).toBeLessThanOrEqual(10);
    expect(result.staffPicks).toMatchObject({ maxPaid: 25, usable: 50 });
    expect(result.staffPicks.paid).toBeLessThanOrEqual(25);
  });

  it('is independent of candidate and Staff Pick input order', () => {
    const fixture = productionFixture();
    const expected = selectPaidPatterns({ ...fixture, seed: 'stable-order' });
    const actual = selectPaidPatterns({
      candidates: [...fixture.candidates].reverse(),
      seed: 'stable-order',
      staffPickPatternIds: [...fixture.staffPickPatternIds].reverse(),
    });

    expect(actual).toEqual(expected);
  });

  it('produces different selections for different seeds', () => {
    const fixture = productionFixture();
    const first = selectPaidPatterns({ ...fixture, seed: 'first-seed' });
    const second = selectPaidPatterns({ ...fixture, seed: 'second-seed' });

    expect(first.selectedPatternIds).not.toEqual(second.selectedPatternIds);
  });

  it('retries when attempt zero violates the small-tier constraint', () => {
    const fixture = productionFixture();
    // Same seed with a small-tier range that accepts anything exposes what
    // attempt zero would have selected, so the retry is shown to be caused by
    // the small-tier rule and not by some unrelated re-roll.
    const attemptZero = selectPaidPatterns({
      ...fixture,
      rules: { maxAttempts: 1, maxSmallPaid: 60, minSmallPaid: 1 },
      seed: 'retry-seed',
    });
    const result = selectPaidPatterns({ ...fixture, seed: 'retry-seed' });

    expect(attemptZero.attempt).toBe(0);
    expect(attemptZero.perTier.small < 6 || attemptZero.perTier.small > 10).toBe(true);
    expect(result.attempt).toBeGreaterThan(0);
    expect(result.perTier.small).toBeGreaterThanOrEqual(6);
    expect(result.perTier.small).toBeLessThanOrEqual(10);
  });

  it('keeps paid Staff Picks within the cap even when it binds hard', () => {
    const fixture = productionFixture();
    // One Staff Pick in each of three categories caps paid Staff Picks at one,
    // which attempt zero frequently exceeds.
    const staffPickPatternIds = fixture.candidates
      .filter((candidate) => candidate.id.endsWith('000000000000'))
      .slice(0, 3)
      .map((candidate) => candidate.id);
    const results = ['cap-0', 'cap-1', 'cap-2', 'cap-3', 'cap-4', 'cap-5'].map((seed) =>
      selectPaidPatterns({ candidates: fixture.candidates, seed, staffPickPatternIds }),
    );

    expect(results[0].staffPicks).toMatchObject({ maxPaid: 1, usable: 3 });
    expect(results.every((result) => result.staffPicks.paid <= result.staffPicks.maxPaid)).toBe(true);
    expect(results.some((result) => result.attempt > 0)).toBe(true);
  });

  it('ignores Community and non-available Patterns', () => {
    const usable = candidates(6);
    const result = selectPaidPatterns({
      candidates: [
        ...usable,
        ...candidates(3, { categoryCode: 'community', patternType: 'community' }),
        ...candidates(3, { categoryCode: 'withdrawn', status: 'withdrawn' }),
      ],
      rules: { maxSmallPaid: 1, minSmallPaid: 1, paidPerCategory: 1 },
      seed: 'ignored',
      staffPickPatternIds: [],
    });

    expect(result.perCategory).toEqual([
      { categoryCode: 'animals', eligible: 6, excluded: 0, free: 5, paid: 1, usable: 6 },
    ]);
  });

  it('excludes an eligible Pattern with an unknown stitchable-cell count', () => {
    const fixture = candidates(7);
    fixture[0].stitchableCellCount = null;
    const result = selectPaidPatterns({
      candidates: fixture,
      rules: { maxSmallPaid: 1, minSmallPaid: 1, paidPerCategory: 1 },
      seed: 'excluded',
      staffPickPatternIds: [],
    });

    expect(result.excluded).toEqual([{
      categoryCode: 'animals',
      id: '00000000-0000-4000-8000-000000000000',
      reason: 'stitchable_cell_count_unknown',
      title: 'Pattern 0',
    }]);
  });

  it('excludes an eligible Pattern whose id is not a v4 UUID', () => {
    const fixture = candidates(7);
    fixture[0].id = 'not-a-uuid';
    const result = selectPaidPatterns({
      candidates: fixture,
      rules: { maxSmallPaid: 1, minSmallPaid: 1, paidPerCategory: 1 },
      seed: 'invalid-id',
      staffPickPatternIds: [],
    });

    expect(result.excluded).toEqual([{
      categoryCode: 'animals',
      id: 'not-a-uuid',
      reason: 'pattern_id_not_uuid_v4',
      title: 'Pattern 0',
    }]);
    expect(result.selectedPatternIds).not.toContain('not-a-uuid');
  });

  it('throws when a usable category is too small', () => {
    expectSelectionError('category_too_small', () => selectPaidPatterns({
      candidates: candidates(5),
      seed: 'small-category',
      staffPickPatternIds: [],
    }));
  });

  it('throws instead of shrinking the rollout when a whole category is excluded', () => {
    const fixture = productionFixture();
    for (const candidate of fixture.candidates) {
      if (candidate.categoryCode === 'category-03') candidate.stitchableCellCount = null;
    }

    expectSelectionError('category_too_small', () => selectPaidPatterns({
      ...fixture,
      seed: 'production-seed',
    }));
  });

  it('throws when constraints cannot be satisfied', () => {
    expectSelectionError('constraints_unsatisfied', () => selectPaidPatterns({
      candidates: candidates(6, { stitchableCellCount: 1_000 }),
      rules: { maxAttempts: 5, maxSmallPaid: 1, minSmallPaid: 1 },
      seed: 'impossible',
      staffPickPatternIds: [],
    }));
  });

  it('warns for currently-paid usable Patterns not selected', () => {
    const result = selectPaidPatterns({
      candidates: candidates(7, { unlockPriceTier: 'medium' }),
      rules: { maxSmallPaid: 6, minSmallPaid: 6, paidPerCategory: 6 },
      seed: 'warning',
      staffPickPatternIds: [],
    });

    expect(result.warnings.currentlyPaidNotSelected).toHaveLength(1);
  });

  it.each([
    ['empty_seed', { seed: '   ' }],
    ['invalid_rules', { rules: { maxAttempts: 0 } }],
    ['invalid_rules', { rules: { minSmallPaid: 3, maxSmallPaid: 2 } }],
  ])('throws %s for invalid input', (code, overrides) => {
    expectSelectionError(code, () => selectPaidPatterns({
      candidates: candidates(6),
      seed: 'valid',
      staffPickPatternIds: [],
      ...overrides,
    }));
  });

  it('keeps the digest stable for a fixed fixture and seed', () => {
    const fixture = productionFixture();
    const result = selectPaidPatterns({ ...fixture, seed: 'digest-seed' });

    expect(result.selectionDigest).toBe('dbc85f80345ea6176aacb1be049f8afdc0ea43984d99a8348dbb369b0e9ff0fd');
  });
});
