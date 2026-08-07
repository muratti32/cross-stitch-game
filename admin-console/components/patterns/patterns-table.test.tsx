// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdminPatternListItem } from '@/lib/types';

import { bulkRemovalReasonId } from './bulk-remove-policy';
import { PatternsTable } from './patterns-table';

function pattern(overrides: Partial<AdminPatternListItem>): AdminPatternListItem {
  return {
    categoryCode: 'animals', createdAt: '2026-08-01T00:00:00.000Z', creatorName: 'Stitch Wish',
    id: 'official', patternType: 'official', previewUrl: '/preview.webp', publishedAt: '2026-08-01T00:00:00.000Z',
    status: 'available', title: 'Fox', unlockPriceTier: null, ...overrides,
  };
}

afterEach(cleanup);

describe('PatternsTable bulk selection', () => {
  it('selects eligible rows, selects all eligible rows, and describes disabled rows', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    const items = [
      pattern({ id: 'fox', title: 'Fox' }),
      pattern({ id: 'owl', status: 'withdrawn', title: 'Owl' }),
      pattern({ id: 'community', patternType: 'community', title: 'Community Bee' }),
      pattern({ id: 'hold', status: 'review_hold', title: 'Held Cat' }),
      pattern({ id: 'removed', status: 'removed', title: 'Removed Dog' }),
    ];

    const { rerender } = render(
      <PatternsTable items={items} categoriesByCode={new Map()} selectedIds={new Set()} onSelectionChange={onSelectionChange} />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Select Fox' }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['fox']));

    await user.click(screen.getByRole('checkbox', { name: /Select all eligible/ }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['fox', 'owl']));

    for (const title of ['Community Bee', 'Held Cat', 'Removed Dog']) {
      const checkbox = screen.getByRole('checkbox', { name: `Select ${title}` });
      expect(
        checkbox.hasAttribute('disabled') ||
        checkbox.getAttribute('aria-disabled') === 'true' ||
        checkbox.hasAttribute('data-disabled'),
      ).toBe(true);
    }
    const communityCheckbox = screen.getByRole('checkbox', { name: 'Select Community Bee' });
    expect(communityCheckbox.getAttribute('aria-describedby')).toBe(bulkRemovalReasonId('community'));
    expect(document.getElementById(bulkRemovalReasonId('community'))?.textContent).toContain('Community Patterns');

    rerender(
      <PatternsTable items={items} categoriesByCode={new Map()} selectedIds={new Set(['fox', 'owl'])} onSelectionChange={onSelectionChange} />,
    );
    expect(screen.getByRole('checkbox', { name: /Select all eligible/ }).getAttribute('data-checked')).not.toBeNull();
  });
});
