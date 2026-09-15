import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { hasSeenPaidPatternsBanner, markPaidPatternsBannerSeen } from '@/local-db';
import { usePaidPatternsBanner } from '../usePaidPatternsBanner';
import { captureLocalPersistenceError } from '@/observability/sentry';

jest.mock('@/local-db', () => ({
  hasSeenPaidPatternsBanner: jest.fn(),
  markPaidPatternsBannerSeen: jest.fn(),
}));
jest.mock('@/observability/sentry', () => ({ captureLocalPersistenceError: jest.fn() }));

const hasSeen = hasSeenPaidPatternsBanner as jest.MockedFunction<typeof hasSeenPaidPatternsBanner>;
const markSeen = markPaidPatternsBannerSeen as jest.MockedFunction<typeof markPaidPatternsBannerSeen>;

describe('usePaidPatternsBanner', () => {
  let state: ReturnType<typeof usePaidPatternsBanner>;

  function Harness({ hasPaidPattern }: { hasPaidPattern: boolean }) {
    state = usePaidPatternsBanner(hasPaidPattern);
    return null;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    markSeen.mockResolvedValue(undefined);
  });

  it.each([
    { seen: false, paid: true, visible: true },
    { seen: true, paid: true, visible: false },
    { seen: false, paid: false, visible: false },
  ])('resolves seen=$seen paid=$paid to visible=$visible', async ({ seen, paid, visible }) => {
    hasSeen.mockResolvedValue(seen);
    await act(async () => { TestRenderer.create(<Harness hasPaidPattern={paid} />); });
    expect(state.visible).toBe(visible);
  });

  it('hides immediately and persists dismissal', async () => {
    hasSeen.mockResolvedValue(false);
    await act(async () => { TestRenderer.create(<Harness hasPaidPattern />); });
    act(() => state.dismiss());
    expect(state.visible).toBe(false);
    expect(markSeen).toHaveBeenCalledTimes(1);
  });

  it('stays hidden and reports a failed dismissal write', async () => {
    const error = new Error('database unavailable');
    hasSeen.mockResolvedValue(false);
    markSeen.mockRejectedValue(error);
    await act(async () => { TestRenderer.create(<Harness hasPaidPattern />); });
    await act(async () => { state.dismiss(); });
    expect(state.visible).toBe(false);
    expect(captureLocalPersistenceError).toHaveBeenCalledWith(
      'mark-paid-patterns-banner-seen',
      error,
    );
  });

  it('stays hidden when the seen flag cannot be read', async () => {
    hasSeen.mockRejectedValue(new Error('database unavailable'));
    await act(async () => { TestRenderer.create(<Harness hasPaidPattern />); });
    expect(state.visible).toBe(false);
  });
});
