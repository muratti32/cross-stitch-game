'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import type { Category, TagLabel } from '@/lib/types';

export function useCategories() {
  return useQuery({
    queryFn: () => api.get<Category[]>('/api/admin/categories'),
    queryKey: ['categories'],
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string; labels: TagLabel[] }) => api.post<Category>('/api/admin/categories', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

export function useUpdateCategoryLabels(code: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (labels: TagLabel[]) => api.put<Category>(`/api/admin/categories/${code}/labels`, { labels }),
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
