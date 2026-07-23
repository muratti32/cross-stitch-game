'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import type {
  CatalogRejectionReason,
  CatalogSubmissionReview,
  CatalogSubmissionReviewDetail,
  CatalogSubmissionStatus,
} from '@/lib/types';

export function useCatalogSubmissions(status?: CatalogSubmissionStatus) {
  return useQuery({
    queryFn: () => api.get<CatalogSubmissionReview[]>(
      `/api/admin/catalog-submissions${status === undefined ? '' : `?status=${encodeURIComponent(status)}`}`,
    ),
    queryKey: ['catalog-submissions', status ?? 'review-queue'],
  });
}

export function useCatalogSubmission(id: string) {
  return useQuery({
    queryFn: () => api.get<CatalogSubmissionReviewDetail>(`/api/admin/catalog-submissions/${id}`),
    queryKey: ['catalog-submission', id],
  });
}

export function useAcceptCatalogSubmission(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { note?: string }) =>
      api.post<CatalogSubmissionReview>(`/api/admin/catalog-submissions/${id}/accept`, input),
    onSuccess: () => invalidateReviewQueries(queryClient, id),
  });
}

export function useRejectCatalogSubmission(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { note?: string; reason: CatalogRejectionReason }) =>
      api.post<CatalogSubmissionReview>(`/api/admin/catalog-submissions/${id}/reject`, input),
    onSuccess: () => invalidateReviewQueries(queryClient, id),
  });
}

function invalidateReviewQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
): void {
  void queryClient.invalidateQueries({ queryKey: ['catalog-submission', id] });
  void queryClient.invalidateQueries({ queryKey: ['catalog-submissions'] });
}
