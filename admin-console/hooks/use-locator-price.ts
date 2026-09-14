'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/client/fetcher';
import type { LocatorPriceSetting } from '@/lib/types';

const locatorPriceQueryKey = ['economy', 'locator-price'] as const;

export function useLocatorPrice() {
  return useQuery({
    queryFn: () => api.get<LocatorPriceSetting>('/api/admin/economy/locator-price'),
    queryKey: locatorPriceQueryKey,
  });
}

export function useUpdateLocatorPrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (price: number) => api.put<LocatorPriceSetting>('/api/admin/economy/locator-price', { price }),
    onSuccess: (setting) => {
      queryClient.setQueryData(locatorPriceQueryKey, setting);
    },
  });
}
