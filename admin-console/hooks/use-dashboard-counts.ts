'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import type { AdminPatternPage, OfficialPatternDraftPage, OfficialPatternDraftStatus, PatternStatus } from '@/lib/types';

const PATTERN_STATUSES: readonly PatternStatus[] = ['available', 'withdrawn', 'removed'];
const DRAFT_STATUSES: readonly OfficialPatternDraftStatus[] = [
  'pending',
  'processing',
  'ready',
  'failed',
  'published',
  'discarded',
];

export interface DashboardCounts {
  patterns: Record<PatternStatus, number>;
  drafts: Record<OfficialPatternDraftStatus, number>;
}

// There is no dedicated counts endpoint; each status's `total` comes from the
// existing paginated list endpoints with pageSize=1, which is cheap because
// the backend counts server-side (getManyAndCount) rather than transferring
// full pages of data.
export function useDashboardCounts() {
  return useQuery({
    queryFn: async (): Promise<DashboardCounts> => {
      const [patternEntries, draftEntries] = await Promise.all([
        Promise.all(
          PATTERN_STATUSES.map(async (status) => {
            const page = await api.get<AdminPatternPage>(
              `/api/admin/patterns?status=${status}&page=1&pageSize=1`,
            );
            return [status, page.total] as const;
          }),
        ),
        Promise.all(
          DRAFT_STATUSES.map(async (status) => {
            const page = await api.get<OfficialPatternDraftPage>(
              `/api/admin/pattern-drafts?status=${status}&page=1&pageSize=1`,
            );
            return [status, page.total] as const;
          }),
        ),
      ]);
      return {
        drafts: Object.fromEntries(draftEntries) as Record<OfficialPatternDraftStatus, number>,
        patterns: Object.fromEntries(patternEntries) as Record<PatternStatus, number>,
      };
    },
    queryKey: ['dashboard-counts'],
  });
}
