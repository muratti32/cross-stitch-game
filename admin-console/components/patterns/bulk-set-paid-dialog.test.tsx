// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BulkSetPaidDialog } from './bulk-set-paid-dialog';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('@/hooks/use-patterns', () => ({
  useBulkSetPatternsPaid: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('BulkSetPaidDialog', () => {
  it('keeps the dialog open and renders partial results', async () => {
    mocks.mutateAsync.mockResolvedValue({ paid: true, results: [
      { afterTier: 'small', beforeTier: null, grandfatheredCount: 3, outcome: 'changed', patternId: 'fox' },
      { errorCode: 'stitchable_cell_count_unknown', outcome: 'failed', patternId: 'owl' },
    ] });
    const base = { categoryCode: 'animals', createdAt: '', creatorName: 'CrossCraft', patternType: 'official' as const, previewUrl: '', publishedAt: '', status: 'available' as const, unlockPriceTier: null };
    const user = userEvent.setup();
    render(<BulkSetPaidDialog patterns={[
      { ...base, id: 'fox', title: 'Fox' }, { ...base, id: 'owl', title: 'Owl' },
    ]} paid open onOpenChange={vi.fn()} onSuccess={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Make paid' }));
    expect(await screen.findByText('1 changed, 0 unchanged, 1 failed. 3 players or guests grandfathered.')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Paid change results' })).not.toBeNull();
    expect(screen.getByText(/Fox: Changed — Small \(75\); 3 players or guests grandfathered/)).not.toBeNull();
    expect(screen.getByText(/Owl: Failed — This Pattern has no recorded/)).not.toBeNull();
  });

  it('shows request errors as an alert', async () => {
    mocks.mutateAsync.mockRejectedValueOnce(new Error('Network failed'));
    const user = userEvent.setup();
    render(<BulkSetPaidDialog patterns={[{
      categoryCode: 'animals', createdAt: '', creatorName: 'CrossCraft', id: 'fox', patternType: 'official',
      previewUrl: '', publishedAt: '', status: 'available', title: 'Fox', unlockPriceTier: null,
    }]} paid open onOpenChange={vi.fn()} onSuccess={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Make paid' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Network failed');
  });

  it('calls onSuccess when closing results', async () => {
    const result = { paid: true, results: [] };
    mocks.mutateAsync.mockResolvedValueOnce(result);
    const onSuccess = vi.fn();
    const user = userEvent.setup();
    render(<BulkSetPaidDialog patterns={[{
      categoryCode: 'animals', createdAt: '', creatorName: 'CrossCraft', id: 'fox', patternType: 'official',
      previewUrl: '', publishedAt: '', status: 'available', title: 'Fox', unlockPriceTier: null,
    }]} paid open onOpenChange={vi.fn()} onSuccess={onSuccess} />);
    await user.click(screen.getByRole('button', { name: 'Make paid' }));
    await screen.findByRole('heading', { name: 'Paid change results' });
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    expect(onSuccess).toHaveBeenCalledWith(result);
  });

  it('excludes ineligible rows and reports the skipped count', async () => {
    mocks.mutateAsync.mockResolvedValueOnce({ paid: false, results: [] });
    const base = { categoryCode: 'animals', createdAt: '', creatorName: 'CrossCraft', previewUrl: '', publishedAt: '', title: 'Pattern', unlockPriceTier: 'small' as const };
    const user = userEvent.setup();
    render(<BulkSetPaidDialog patterns={[
      { ...base, id: 'fox', patternType: 'official', status: 'available' },
      { ...base, id: 'bee', patternType: 'community', status: 'available' },
      { ...base, id: 'dog', patternType: 'official', status: 'removed' },
    ]} paid={false} open onOpenChange={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByText(/2 ineligible selected Patterns will be skipped/)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Make free' }));
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({ patternIds: ['fox'], paid: false }));
  });
});
