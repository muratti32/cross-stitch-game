// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/client/fetcher';

import { PatternPaidAction } from './pattern-paid-action';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/use-patterns', () => ({
  useSetPatternPaid: () => ({ mutateAsync: mocks.mutateAsync }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toast } }));

const pattern = {
  categoryCode: 'animals', createdAt: '', creatorName: 'CrossCraft', height: 40, id: 'fox',
  paletteSize: 8, patternType: 'official' as const, previewUrl: '', publishedAt: '',
  status: 'available' as const, tags: [], title: 'Fox', unlockPriceTier: null, width: 40,
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PatternPaidAction', () => {
  it('confirms and reports the derived price and grandfathering', async () => {
    mocks.mutateAsync.mockResolvedValue({ afterTier: 'medium', beforeTier: null, changed: true, grandfatheredCount: 12, patternId: 'fox' });
    const user = userEvent.setup();
    render(<PatternPaidAction pattern={pattern} />);
    await user.click(screen.getByRole('button', { name: 'Make paid' }));
    expect(screen.getByText(/Small \(75\).*Medium \(150\).*Large \(300\)/)).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Make paid' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('Pattern is now paid: Medium (150). 12 players or guests grandfathered.'));
  });

  it('shows code-only backend errors inside the dialog', async () => {
    mocks.mutateAsync.mockRejectedValue(new ApiError(409, { code: 'pattern_not_eligible' }, 'Request failed'));
    const user = userEvent.setup();
    render(<PatternPaidAction pattern={pattern} />);
    await user.click(screen.getByRole('button', { name: 'Make paid' }));
    await user.click(screen.getByRole('button', { name: 'Make paid' }));
    expect(await screen.findByText(/Only Official Patterns/)).not.toBeNull();
  });
});
