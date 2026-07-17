'use client';

import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import type { Category } from '@/lib/types';

export function useCategories() {
  return useQuery({
    queryFn: () => api.get<Category[]>('/api/catalog/categories'),
    queryKey: ['categories'],
    staleTime: Number.POSITIVE_INFINITY,
  });
}
