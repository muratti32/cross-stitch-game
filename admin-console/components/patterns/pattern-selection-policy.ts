import type { AdminPatternListItem } from '@/lib/types';

export const MAX_SELECTED_PATTERNS = 50;

export function patternSelectionReasonId(patternId: string): string {
  return `pattern-selection-reason-${patternId}`;
}

export function getPatternSelectionIneligibility(pattern: AdminPatternListItem): string | null {
  if (pattern.patternType === 'community') {
    return 'Only Official Patterns can be selected for these bulk actions.';
  }
  if (pattern.status === 'removed') {
    return 'Removed Official Patterns cannot be selected for these bulk actions.';
  }
  return null;
}

export function selectablePatternIds(items: AdminPatternListItem[]): string[] {
  return items
    .filter((pattern) => getPatternSelectionIneligibility(pattern) === null)
    .map((pattern) => pattern.id)
    .slice(0, MAX_SELECTED_PATTERNS);
}
