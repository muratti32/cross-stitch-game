'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import { buildQueryString } from '@/lib/client/query-string';
import type {
  CreateDraftResponse,
  DiscardDraftResponse,
  OfficialPatternDraftPage,
  OfficialPatternDraftStatus,
  OfficialPatternDraftView,
  PublishDraftInput,
  PublishDraftResponse,
} from '@/lib/types';

const ACTIVE_DRAFT_STATUSES: readonly OfficialPatternDraftStatus[] = ['pending', 'processing'];
const POLL_INTERVAL_MS = 3_000;

export interface DraftListParams {
  status?: OfficialPatternDraftStatus;
  page: number;
  pageSize: number;
}

export function useDrafts(params: DraftListParams) {
  return useQuery({
    queryFn: () => api.get<OfficialPatternDraftPage>(`/api/admin/pattern-drafts${buildQueryString(params)}`),
    queryKey: ['drafts', params],
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasActiveDraft = items.some((item) => ACTIVE_DRAFT_STATUSES.includes(item.status));
      return hasActiveDraft ? POLL_INTERVAL_MS : false;
    },
  });
}

export function useDraft(id: string) {
  return useQuery({
    queryFn: () => api.get<OfficialPatternDraftView>(`/api/admin/pattern-drafts/${id}`),
    queryKey: ['draft', id],
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && ACTIVE_DRAFT_STATUSES.includes(status) ? POLL_INTERVAL_MS : false;
    },
  });
}

export function useCreateDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { sourceImage: File; shortEdgeCells: number; maxColors: number }) => {
      const form = new FormData();
      form.set('sourceImage', input.sourceImage);
      form.set('shortEdgeCells', String(input.shortEdgeCells));
      form.set('maxColors', String(input.maxColors));
      return api.postForm<CreateDraftResponse>('/api/admin/pattern-drafts', form);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] });
    },
  });
}

export function usePublishDraft(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PublishDraftInput) =>
      api.post<PublishDraftResponse>(`/api/admin/pattern-drafts/${id}/publish`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['draft', id] });
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-patterns'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] });
    },
  });
}

export function useDiscardDraft(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<DiscardDraftResponse>(`/api/admin/pattern-drafts/${id}/discard`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['draft', id] });
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] });
    },
  });
}
