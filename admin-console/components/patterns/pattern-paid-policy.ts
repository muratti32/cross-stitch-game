import { ApiError } from '@/lib/client/fetcher';
import type { AdminPatternListItem, BulkSetPatternsPaidResponse, PatternPaidErrorCode } from '@/lib/types';

const ERROR_MESSAGES: Record<PatternPaidErrorCode, string> = {
  internal_error: 'The Pattern could not be updated because of an internal error.',
  pattern_not_eligible: 'Only Official Patterns that are available, withdrawn, or on Review Hold can be changed.',
  pattern_not_found: 'The Pattern was not found.',
  stitchable_cell_count_unknown: 'This Pattern has no recorded stitchable-cell count and cannot be made paid.',
};

export function getPatternPaidIneligibility(pattern: AdminPatternListItem): string | null {
  if (pattern.patternType === 'community') return 'Community Patterns cannot be changed here.';
  if (pattern.status === 'removed') return 'Removed Official Patterns cannot be changed.';
  return null;
}

export function patternPaidErrorMessage(error: unknown): string {
  if (typeof error === 'string' && error in ERROR_MESSAGES) return ERROR_MESSAGES[error as PatternPaidErrorCode];
  if (error instanceof ApiError && typeof error.payload === 'object' && error.payload !== null && 'code' in error.payload) {
    const code = (error.payload as { code?: unknown }).code;
    if (typeof code === 'string' && code in ERROR_MESSAGES) return ERROR_MESSAGES[code as PatternPaidErrorCode];
  }
  return error instanceof Error ? error.message : 'The Pattern price could not be updated.';
}

export function formatBulkPaidSummary(result: BulkSetPatternsPaidResponse): string {
  const changed = result.results.filter((item) => item.outcome === 'changed').length;
  const unchanged = result.results.filter((item) => item.outcome === 'unchanged').length;
  const failed = result.results.filter((item) => item.outcome === 'failed').length;
  const grandfathered = result.results.reduce(
    (sum, item) => sum + (item.outcome === 'changed' && item.afterTier !== null ? item.grandfatheredCount : 0), 0,
  );
  return `${changed} changed, ${unchanged} unchanged, ${failed} failed. ${grandfathered} players or guests grandfathered.`;
}
