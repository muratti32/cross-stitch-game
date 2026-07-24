'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import type {
  PostPublicationReviewCloseResult,
  PostPublicationReviewDetail,
  PostPublicationReviewListItem,
  ReviewHoldResult,
} from '@/lib/types';

export function usePostPublicationReviews() {
  return useQuery({
    queryFn: () =>
      api.get<PostPublicationReviewListItem[]>('/api/admin/post-publication-reviews'),
    queryKey: ['post-publication-reviews'],
  });
}

export function usePostPublicationReview(id: string) {
  return useQuery({
    queryFn: () =>
      api.get<PostPublicationReviewDetail>(`/api/admin/post-publication-reviews/${id}`),
    queryKey: ['post-publication-review', id],
  });
}

export function useApplyReviewHold(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      api.post<ReviewHoldResult>(`/api/admin/post-publication-reviews/${id}/hold`, {
        reason,
      }),
    onSuccess: () => invalidateReviewQueries(queryClient, id),
  });
}

export function useCloseReviewNoViolation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      api.post<PostPublicationReviewCloseResult>(
        `/api/admin/post-publication-reviews/${id}/close`,
        { reason },
      ),
    onSuccess: () => invalidateReviewQueries(queryClient, id),
  });
}

export function useApplyCatalogMetadataRemediation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { categoryCode?: string; reason: string; removeTagCodes: string[] }) =>
      api.post<PostPublicationReviewCloseResult>(
        `/api/admin/post-publication-reviews/${id}/remediate`,
        input,
      ),
    onSuccess: () => invalidateReviewQueries(queryClient, id),
  });
}

export function useApplySafetyRemoval(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      api.post<PostPublicationReviewCloseResult>(
        `/api/admin/post-publication-reviews/${id}/safety-removal`,
        { reason },
      ),
    onSuccess: () => invalidateReviewQueries(queryClient, id),
  });
}

function invalidateReviewQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
): void {
  void queryClient.invalidateQueries({ queryKey: ['post-publication-review', id] });
  void queryClient.invalidateQueries({ queryKey: ['post-publication-reviews'] });
  void queryClient.invalidateQueries({ queryKey: ['patterns'] });
  void queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] });
}
