'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import { buildQueryString } from '@/lib/client/query-string';
import type { AdminPatternDetail, AdminPatternPage, PatternStatus, UpdatePatternMetadataInput } from '@/lib/types';

export type PatternListParams = {
  status?: PatternStatus;
  search?: string;
  page: number;
  pageSize: number;
};

export function usePatterns(params: PatternListParams) {
  return useQuery({
    queryFn: () => api.get<AdminPatternPage>(`/api/admin/patterns${buildQueryString(params)}`),
    queryKey: ['admin-patterns', params],
  });
}

export function usePattern(id: string) {
  return useQuery({
    queryFn: () => api.get<AdminPatternDetail>(`/api/admin/patterns/${id}`),
    queryKey: ['admin-pattern', id],
  });
}

export function useUpdatePatternMetadata(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePatternMetadataInput) =>
      api.put<AdminPatternDetail>(`/api/admin/patterns/${id}/metadata`, input),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-pattern', id], data);
      void queryClient.invalidateQueries({ queryKey: ['admin-patterns'] });
    },
  });
}

function usePatternStatusMutation(id: string, action: 'withdraw' | 'remove' | 'restore') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<AdminPatternDetail>(`/api/admin/patterns/${id}/${action}`),
    onSuccess: (data) => {
      queryClient.setQueryData(['admin-pattern', id], data);
      void queryClient.invalidateQueries({ queryKey: ['admin-patterns'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] });
      void queryClient.invalidateQueries({ queryKey: ['staff-picks'] });
    },
  });
}

export function useWithdrawPattern(id: string) {
  return usePatternStatusMutation(id, 'withdraw');
}

export function useRemovePattern(id: string) {
  return usePatternStatusMutation(id, 'remove');
}

export function useRestorePattern(id: string) {
  return usePatternStatusMutation(id, 'restore');
}
