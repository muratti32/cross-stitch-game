'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import { buildQueryString } from '@/lib/client/query-string';
import type { AdminPatternDetail, AdminPatternPage, BulkRemovePatternsInput, BulkRemovePatternsResponse, BulkSetPatternsPaidInput, BulkSetPatternsPaidResponse, PatternStatus, SetPatternPaidResponse, UpdatePatternMetadataInput } from '@/lib/types';

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

export function useSetPatternPaid(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paid: boolean) =>
      api.put<SetPatternPaidResponse>(`/api/admin/patterns/${id}/paid`, { paid }),
    onSuccess: (result) => {
      queryClient.setQueryData<AdminPatternDetail>(['admin-pattern', id], (current) =>
        current === undefined ? current : { ...current, unlockPriceTier: result.afterTier },
      );
      return queryClient.invalidateQueries({ queryKey: ['admin-patterns'] });
    },
  });
}

export function useBulkSetPatternsPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkSetPatternsPaidInput) =>
      api.post<BulkSetPatternsPaidResponse>('/api/admin/patterns/bulk-paid', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-patterns'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-pattern'] });
    },
  });
}

export function useBulkRemovePatterns() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BulkRemovePatternsInput) =>
      api.post<BulkRemovePatternsResponse>('/api/admin/patterns/bulk-remove', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-patterns'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] });
      void queryClient.invalidateQueries({ queryKey: ['staff-picks'] });
    },
  });
}
