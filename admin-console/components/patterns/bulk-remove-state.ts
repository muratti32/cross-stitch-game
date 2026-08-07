import type { PatternStatus } from '@/lib/types';

export interface BulkRemoveDialogState {
  error: string | null;
  reason: string;
}

export function initialBulkRemoveDialogState(): BulkRemoveDialogState {
  return { error: null, reason: '' };
}

export function bulkRemoveSubmissionFailed(
  state: BulkRemoveDialogState,
  error: unknown,
): BulkRemoveDialogState {
  return {
    ...state,
    error: error instanceof Error ? error.message : 'Bulk removal failed. Please try again.',
  };
}

export function pageAfterBulkRemoval(options: {
  currentPage: number;
  pageSize: number;
  removedCount: number;
  status: 'all' | PatternStatus;
  totalBefore: number;
}): number {
  const removedRowsLeaveFilter =
    options.status === 'available' || options.status === 'withdrawn';
  const totalAfter = Math.max(
    0,
    options.totalBefore - (removedRowsLeaveFilter ? options.removedCount : 0),
  );
  const lastPage = Math.max(1, Math.ceil(totalAfter / options.pageSize));
  return Math.min(options.currentPage, lastPage);
}
