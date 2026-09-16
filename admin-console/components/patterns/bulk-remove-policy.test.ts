import { describe, expect, it } from 'vitest';

import type { AdminPatternListItem } from '@/lib/types';
import { getBulkRemovalIneligibility } from './bulk-remove-policy';
import { getPatternSelectionIneligibility, selectablePatternIds } from './pattern-selection-policy';

function pattern(overrides: Partial<AdminPatternListItem> = {}): AdminPatternListItem {
  return {
    categoryCode: 'animals', createdAt: '', creatorName: 'Stitch Wish',
    id: 'official', patternType: 'official', previewUrl: '', publishedAt: '',
    status: 'available', title: 'Fox', unlockPriceTier: null, ...overrides,
    stitchableCellCount: overrides.stitchableCellCount ?? null,
  };
}

describe('bulk remove selection policy', () => {
  it('provides a concrete explanation for every disabled row', () => {
    expect(getBulkRemovalIneligibility(pattern({ patternType: 'community' }))).toContain('Community');
    expect(getBulkRemovalIneligibility(pattern({ status: 'review_hold' }))).toContain('Review Hold');
    expect(getBulkRemovalIneligibility(pattern({ status: 'removed' }))).toContain('already removed');
  });
});

describe('shared Pattern selection policy', () => {
  it('includes Review Hold and caps selection at 50', () => {
    const items = [pattern({ id: 'hold', status: 'review_hold' }), ...Array.from(
      { length: 55 }, (_, id) => pattern({ id: String(id) }),
    )];
    expect(selectablePatternIds(items)).toHaveLength(50);
    expect(selectablePatternIds(items)).toContain('hold');
  });

  it('excludes Community and removed Patterns with reasons', () => {
    expect(getPatternSelectionIneligibility(pattern({ patternType: 'community' }))).toContain('Official');
    expect(getPatternSelectionIneligibility(pattern({ status: 'removed' }))).toContain('Removed');
  });
});
