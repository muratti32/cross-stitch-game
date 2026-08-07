import { describe, expect, it } from 'vitest';

import {
  bulkRemoveSubmissionFailed,
  pageAfterBulkRemoval,
} from './bulk-remove-state';

describe('bulk removal UI transitions', () => {
  it('failure retains the reason and exposes the concrete backend error', () => {
    expect(bulkRemoveSubmissionFailed(
      { error: null, reason: 'Confirmed policy removal' },
      new Error('Pattern owl is no longer eligible'),
    )).toEqual({
      error: 'Pattern owl is no longer eligible',
      reason: 'Confirmed policy removal',
    });
  });

  it('does not shrink total or jump backward for the all-status filter', () => {
    expect(pageAfterBulkRemoval({
      currentPage: 3, pageSize: 20, removedCount: 20, status: 'all', totalBefore: 41,
    })).toBe(3);
  });

  it.each(['available', 'withdrawn'] as const)(
    'clamps an invalidated %s page while preserving the active filter',
    (status) => {
      expect(pageAfterBulkRemoval({
        currentPage: 3, pageSize: 20, removedCount: 20, status, totalBefore: 41,
      })).toBe(2);
    },
  );
});
