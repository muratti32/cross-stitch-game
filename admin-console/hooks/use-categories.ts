'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import type { Category } from '@/lib/types';

export function useCategories() {
  return useQuery({
    queryFn: () => api.get<Category[]>('/api/admin/categories'),
    queryKey: ['categories'],
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string; label: string }) => api.post<Category>('/api/admin/categories', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

export function useUpdateCategoryLabel(code: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (label: string) => api.put<Category>(`/api/admin/categories/${code}/label`, { label }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

export function useDeactivateCategory(code: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ code: string; active: boolean }>(`/api/admin/categories/${code}/deactivate`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}
