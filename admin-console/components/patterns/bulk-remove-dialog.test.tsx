// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdminPatternListItem } from '@/lib/types';

import { BulkRemoveDialog } from './bulk-remove-dialog';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('@/hooks/use-patterns', () => ({
  useBulkRemovePatterns: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }),
}));

const selected: AdminPatternListItem[] = [{
  categoryCode: 'animals', createdAt: '', creatorName: 'Stitch Wish', id: 'fox',
  patternType: 'official', previewUrl: '', publishedAt: '', status: 'available',
  title: 'Fox', unlockPriceTier: null,
}];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('BulkRemoveDialog', () => {
  it('keeps the dialog and reason open with the concrete backend error', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockRejectedValueOnce(new Error('Fox is no longer eligible'));
    const onOpenChange = vi.fn();
    render(<BulkRemoveDialog patterns={selected} open onOpenChange={onOpenChange} onSuccess={vi.fn()} />);

    const reason = screen.getByRole('textbox', { name: /Removal reason/ });
    await user.type(reason, 'Confirmed policy removal');
    await user.click(screen.getByRole('button', { name: 'Remove selected' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Fox is no longer eligible');
    expect((reason as HTMLTextAreaElement).value).toBe('Confirmed policy removal');
    expect(screen.getByRole('dialog')).not.toBeNull();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('reuses the confirmation batch ID after an ambiguous failure', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync
      .mockRejectedValueOnce(new Error('Network response was lost'))
      .mockResolvedValueOnce({ batchId: 'server-batch', patternIds: ['fox'], removedCount: 1 });
    render(<BulkRemoveDialog patterns={selected} open onOpenChange={vi.fn()} onSuccess={vi.fn()} />);

    await user.type(screen.getByRole('textbox', { name: /Removal reason/ }), 'Confirmed policy removal');
    await user.click(screen.getByRole('button', { name: 'Remove selected' }));
    await screen.findByRole('alert');
    expect((screen.getByRole('textbox', { name: /Removal reason/ }) as HTMLTextAreaElement).disabled)
      .toBe(true);
    await user.click(screen.getByRole('button', { name: 'Remove selected' }));

    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(2));
    expect(mocks.mutateAsync.mock.calls[1][0]).toEqual(mocks.mutateAsync.mock.calls[0][0]);
  });

  it('creates a new batch only after a cancelled confirmation is confirmed again', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockRejectedValue(new Error('Network response was lost'));
    const onOpenChange = vi.fn();
    const view = render(
      <BulkRemoveDialog patterns={selected} open onOpenChange={onOpenChange} onSuccess={vi.fn()} />,
    );
    await user.type(screen.getByRole('textbox', { name: /Removal reason/ }), 'Confirmed policy removal');
    await user.click(screen.getByRole('button', { name: 'Remove selected' }));
    await screen.findByRole('alert');
    const firstBatchId = mocks.mutateAsync.mock.calls[0][0].batchId;
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    view.rerender(<BulkRemoveDialog patterns={selected} open={false} onOpenChange={onOpenChange} onSuccess={vi.fn()} />);
    view.rerender(<BulkRemoveDialog patterns={selected} open onOpenChange={onOpenChange} onSuccess={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Remove selected' }));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(2));
    expect(mocks.mutateAsync.mock.calls[1][0].batchId).not.toBe(firstBatchId);
  });

  it('closes on success, returns the removed count, and resets the reason for reopen', async () => {
    const user = userEvent.setup();
    mocks.mutateAsync.mockResolvedValueOnce({ batchId: 'batch', patternIds: ['fox'], removedCount: 1 });
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    const { rerender } = render(
      <BulkRemoveDialog patterns={selected} open onOpenChange={onOpenChange} onSuccess={onSuccess} />,
    );
    await user.type(screen.getByRole('textbox', { name: /Removal reason/ }), 'Confirmed policy removal');
    await user.click(screen.getByRole('button', { name: 'Remove selected' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ batchId: 'batch', patternIds: ['fox'], removedCount: 1 }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<BulkRemoveDialog patterns={selected} open onOpenChange={onOpenChange} onSuccess={onSuccess} />);
    expect((screen.getByRole('textbox', { name: /Removal reason/ }) as HTMLTextAreaElement).value).toBe('');
  });
});
