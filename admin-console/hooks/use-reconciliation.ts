'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import type { ReconciliationReport } from '@/lib/types';

export function useReconciliation() {
  return useQuery({
    queryFn: () => api.get<ReconciliationReport>('/api/admin/reconciliation'),
    queryKey: ['reconciliation'],
  });
}
