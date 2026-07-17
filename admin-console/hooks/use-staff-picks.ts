'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import type { StaffPickItem } from '@/lib/types';

export function useStaffPicks() {
  return useQuery({
    queryFn: () => api.get<StaffPickItem[]>('/api/admin/staff-picks'),
    queryKey: ['staff-picks'],
  });
}

export function useReplaceStaffPicks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patternIds: string[]) =>
      api.put<StaffPickItem[]>('/api/admin/staff-picks', { patternIds }),
    onSuccess: (data) => {
      queryClient.setQueryData(['staff-picks'], data);
      void queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] });
    },
  });
}
