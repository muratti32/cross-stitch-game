// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useBulkRemovePatterns } from './use-patterns';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/client/fetcher', () => ({
  api: { post: mocks.post },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
