import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/client/fetcher';
import type { AdminPatternListItem } from '@/lib/types';

import { formatBulkPaidSummary, getPatternPaidIneligibility, patternPaidErrorMessage } from './pattern-paid-policy';

const pattern: AdminPatternListItem = {
  categoryCode: 'animals', createdAt: '', creatorName: 'CrossCraft', id: 'fox',
  patternType: 'official', previewUrl: '', publishedAt: '', status: 'available',
  title: 'Fox', unlockPriceTier: null,
};

describe('pattern paid policy', () => {
  it('rejects community and removed Patterns', () => {
    expect(getPatternPaidIneligibility({ ...pattern, patternType: 'community' })).toMatch(/Community/);
    expect(getPatternPaidIneligibility({ ...pattern, status: 'removed' })).toMatch(/Removed/);
    expect(getPatternPaidIneligibility(pattern)).toBeNull();
  });

  it('maps API codes that have no message', () => {
    expect(patternPaidErrorMessage(new ApiError(409, { code: 'stitchable_cell_count_unknown' }, 'Request failed')))
      .toMatch(/no recorded stitchable-cell count/);
  });

  it('summarizes partial results', () => {
    expect(formatBulkPaidSummary({ paid: true, results: [
      { afterTier: 'small', beforeTier: null, grandfatheredCount: 4, outcome: 'changed', patternId: 'a' },
      { afterTier: 'medium', beforeTier: 'medium', grandfatheredCount: 0, outcome: 'unchanged', patternId: 'b' },
      { errorCode: 'pattern_not_found', outcome: 'failed', patternId: 'c' },
    ] })).toBe('1 changed, 1 unchanged, 1 failed. 4 players or guests grandfathered.');
  });
});
