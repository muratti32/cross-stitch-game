'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import type {
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['post-publication-review', id] });
      void queryClient.invalidateQueries({ queryKey: ['post-publication-reviews'] });
      void queryClient.invalidateQueries({ queryKey: ['patterns'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] });
    },
  });
}
