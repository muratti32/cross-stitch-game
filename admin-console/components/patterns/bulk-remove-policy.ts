import type { AdminPatternListItem } from '@/lib/types';

export const MAX_BULK_REMOVE_PATTERNS = 20;

export function getBulkRemovalIneligibility(pattern: AdminPatternListItem): string | null {
  if (pattern.patternType === 'community') {
    return 'Community Patterns must be handled through Post-Publication Review.';
  }
  if (pattern.status === 'review_hold') {
    return 'Review Hold must be resolved through Post-Publication Review.';
  }
  if (pattern.status === 'removed') {
    return 'This Official Pattern is already removed.';
  }
  return null;
}
