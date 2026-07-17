'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import type { Tag, TagLabel } from '@/lib/types';

export function useTags() {
  return useQuery({
    queryFn: () => api.get<Tag[]>('/api/admin/tags'),
    queryKey: ['tags'],
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string; labels: TagLabel[] }) => api.post<Tag>('/api/admin/tags', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useUpdateTagLabels(code: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (labels: TagLabel[]) => api.put<Tag>(`/api/admin/tags/${code}/labels`, { labels }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useDeactivateTag(code: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ code: string; active: boolean }>(`/api/admin/tags/${code}/deactivate`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}
