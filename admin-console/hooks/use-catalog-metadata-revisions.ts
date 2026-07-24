'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import type {
  CatalogMetadataRevisionReview,
  CatalogMetadataRevisionReviewDetail,
  CatalogMetadataRevisionStatus,
  CatalogRejectionReason,
} from '@/lib/types';

export function useCatalogMetadataRevisions(status?: CatalogMetadataRevisionStatus) {
  return useQuery({
    queryFn: () => api.get<CatalogMetadataRevisionReview[]>(
      `/api/admin/catalog-metadata-revisions${status === undefined ? '' : `?status=${encodeURIComponent(status)}`}`,
    ),
    queryKey: ['catalog-metadata-revisions', status ?? 'review-queue'],
  });
}

export function useCatalogMetadataRevision(id: string) {
  return useQuery({
    queryFn: () => api.get<CatalogMetadataRevisionReviewDetail>(`/api/admin/catalog-metadata-revisions/${id}`),
    queryKey: ['catalog-metadata-revision', id],
  });
}

export function useAcceptCatalogMetadataRevision(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { note?: string }) =>
      api.post<CatalogMetadataRevisionReview>(`/api/admin/catalog-metadata-revisions/${id}/accept`, input),
    onSuccess: () => invalidateReviewQueries(queryClient, id),
  });
}

export function useRejectCatalogMetadataRevision(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { note?: string; reason: CatalogRejectionReason }) =>
      api.post<CatalogMetadataRevisionReview>(`/api/admin/catalog-metadata-revisions/${id}/reject`, input),
    onSuccess: () => invalidateReviewQueries(queryClient, id),
  });
}

function invalidateReviewQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
): void {
  void queryClient.invalidateQueries({ queryKey: ['catalog-metadata-revision', id] });
  void queryClient.invalidateQueries({ queryKey: ['catalog-metadata-revisions'] });
}
