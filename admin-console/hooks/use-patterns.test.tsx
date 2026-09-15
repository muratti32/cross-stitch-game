// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useBulkRemovePatterns, useBulkSetPatternsPaid, useSetPatternPaid } from './use-patterns';

const mocks = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/client/fetcher', () => ({
  api: { post: mocks.post, put: mocks.put },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('paid Pattern hooks', () => {
  it('PUTs one Pattern, writes detail cache, and invalidates list', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    queryClient.setQueryData(['admin-pattern', 'fox'], { id: 'fox', title: 'Fox', unlockPriceTier: null });
    mocks.put.mockResolvedValue({ afterTier: 'medium', beforeTier: null, changed: true, grandfatheredCount: 2, patternId: 'fox' });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useSetPatternPaid('fox'), { wrapper });
    await act(async () => { await result.current.mutateAsync(true); });
    expect(mocks.put).toHaveBeenCalledWith('/api/admin/patterns/fox/paid', { paid: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-patterns'] });
    expect(queryClient.getQueryData(['admin-pattern', 'fox'])).toEqual({
      id: 'fox', title: 'Fox', unlockPriceTier: 'medium',
    });
  });

  it('POSTs bulk changes and invalidates list and detail prefix', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    mocks.post.mockResolvedValue({ paid: false, results: [] });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useBulkSetPatternsPaid(), { wrapper });
    await act(async () => { await result.current.mutateAsync({ paid: false, patternIds: ['fox'] }); });
    expect(mocks.post).toHaveBeenCalledWith('/api/admin/patterns/bulk-paid', { paid: false, patternIds: ['fox'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-patterns'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-pattern'] });
  });
});

describe('useBulkRemovePatterns', () => {
  it('invalidates pattern list, dashboard counts, and Staff Picks after success', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    mocks.post.mockResolvedValueOnce({ batchId: 'batch', patternIds: ['fox', 'owl'], removedCount: 2 });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useBulkRemovePatterns(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        batchId: 'batch', patternIds: ['fox', 'owl'], reason: 'Confirmed policy removal',
      });
    });

    expect(mocks.post).toHaveBeenCalledWith('/api/admin/patterns/bulk-remove', expect.any(Object));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-patterns'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard-counts'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['staff-picks'] });
  });
});
