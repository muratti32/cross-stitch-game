// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PatternsView } from './patterns-view';

const mocks = vi.hoisted(() => ({ bulkRemove: vi.fn(), usePatterns: vi.fn() }));

vi.mock('@/hooks/use-categories', () => ({
  useCategories: () => ({ data: [] }),
}));
vi.mock('@/hooks/use-patterns', () => ({
  useBulkRemovePatterns: () => ({ isPending: false, mutateAsync: mocks.bulkRemove }),
  usePatterns: mocks.usePatterns,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PatternsView bulk removal wiring', () => {
  it('clears selection on search and clears/clamps the page after success', async () => {
    mocks.usePatterns.mockImplementation(({ page }: { page: number }) => ({
      data: {
        items: [{
          categoryCode: 'animals', createdAt: '2026-08-01T00:00:00.000Z',
          creatorName: 'Stitch Wish', id: 'fox', patternType: 'official',
          previewUrl: '/preview.webp', publishedAt: '2026-08-01T00:00:00.000Z',
          status: 'available', title: 'Fox', unlockPriceTier: null,
        }],
        page,
        pageSize: 20,
        total: 21,
      },
      error: null,
      isError: false,
      isPending: false,
    }));
    mocks.bulkRemove.mockResolvedValue({ batchId: 'batch', removedCount: 1 });
    const user = userEvent.setup();
    render(<PatternsView />);

    await user.click(screen.getByRole('checkbox', { name: 'Select Fox' }));
    expect(screen.getByText('1 selected')).not.toBeNull();
    await user.type(screen.getByPlaceholderText('Search title or creator…'), 'fox');
    expect(screen.queryByText('1 selected')).toBeNull();

    await user.clear(screen.getByPlaceholderText('Search title or creator…'));
    await user.click(screen.getByRole('tab', { name: 'Available' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Page 2 of 2')).not.toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Select Fox' }));
    await user.click(screen.getByRole('button', { name: 'Remove selected' }));
    await user.type(screen.getByRole('textbox', { name: /Removal reason/ }), 'Confirmed policy removal');
    await user.click(screen.getByRole('button', { name: 'Remove selected' }));

    await waitFor(() => expect(screen.getByText('Page 1 of 2')).not.toBeNull());
    expect(screen.queryByText('1 selected')).toBeNull();
    expect(mocks.bulkRemove).toHaveBeenCalledOnce();
  });
});
