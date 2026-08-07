import { describe, expect, it } from 'vitest';

import type { AdminPatternListItem } from '@/lib/types';
import {
  bulkRemovalReasonId,
  eligiblePatternIds,
  getBulkRemovalIneligibility,
} from './bulk-remove-policy';

function pattern(overrides: Partial<AdminPatternListItem> = {}): AdminPatternListItem {
  return {
    categoryCode: 'animals', createdAt: '', creatorName: 'Stitch Wish',
    id: 'official', patternType: 'official', previewUrl: '', publishedAt: '',
    status: 'available', title: 'Fox', unlockPriceTier: null, ...overrides,
  };
}

describe('bulk remove selection policy', () => {
  it('selects only current-page eligible Official Patterns', () => {
    const items = [
      pattern(),
      pattern({ id: 'withdrawn', status: 'withdrawn' }),
      pattern({ id: 'community', patternType: 'community' }),
      pattern({ id: 'hold', status: 'review_hold' }),
      pattern({ id: 'removed', status: 'removed' }),
    ];
    expect(eligiblePatternIds(items)).toEqual(['official', 'withdrawn']);
  });

  it('provides a concrete explanation for every disabled row', () => {
    expect(getBulkRemovalIneligibility(pattern({ patternType: 'community' }))).toContain('Community');
    expect(getBulkRemovalIneligibility(pattern({ status: 'review_hold' }))).toContain('Review Hold');
    expect(getBulkRemovalIneligibility(pattern({ status: 'removed' }))).toContain('already removed');
    expect(bulkRemovalReasonId('stable-id')).toBe('bulk-remove-reason-stable-id');
  });

  it('caps eligible selection at 20 unique page IDs', () => {
    expect(eligiblePatternIds(Array.from({ length: 25 }, (_, id) => pattern({ id: String(id) })))).toHaveLength(20);
  });
});
