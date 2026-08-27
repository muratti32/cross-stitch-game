import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockPersistShownHints = jest.fn(async (_shownHints: readonly string[]) => undefined);

jest.mock('../state', () => ({
  getStartupOnboardingState: () => ({ shownHints: [] }),
  persistShownHints: (shownHints: readonly string[]) => mockPersistShownHints(shownHints),
}));

import { emitTutorialEvent } from '../tutorialEvents';
import { LOCATOR_HINT_IDLE_MS, useJustInTimeHints } from '../useJustInTimeHints';

describe('just-in-time hint executor', () => {
  afterEach(() => {
    jest.useRealTimers();
    mockPersistShownHints.mockClear();
  });

  it('shows a gesture hint only when no mandatory coach mark is active', async () => {
    let hints!: ReturnType<typeof useJustInTimeHints>;
    function Harness({ mandatoryBeatInFlight }: { mandatoryBeatInFlight: boolean }) {
      hints = useJustInTimeHints({ mandatoryBeatInFlight, activeColorHasRemainingCells: false });
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<Harness mandatoryBeatInFlight />); });
    await act(async () => { await emitTutorialEvent({ type: 'pinch_observed' }); });
    expect(hints.visibleHint).toBeNull();

    await act(async () => { renderer.update(<Harness mandatoryBeatInFlight={false} />); });
    await act(async () => { await emitTutorialEvent({ type: 'pinch_observed' }); });
    expect(hints.visibleHint).toBe('anchored_zoom');
    expect(mockPersistShownHints).toHaveBeenCalledWith(['anchored_zoom']);
    await act(async () => { renderer.unmount(); });
  });

  it('restarts the off-path locator timer after every stitch action', async () => {
    jest.useFakeTimers();
    function Harness() {
      useJustInTimeHints({ mandatoryBeatInFlight: false, activeColorHasRemainingCells: true });
      return null;
    }
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(<Harness />); });
    await act(async () => { jest.advanceTimersByTime(LOCATOR_HINT_IDLE_MS - 1); });
    await act(async () => {
      await emitTutorialEvent({ type: 'completed_stitch_recorded', cellIndex: 1, targeted: false });
    });
    await act(async () => { jest.advanceTimersByTime(LOCATOR_HINT_IDLE_MS - 1); });
    expect(mockPersistShownHints).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1); await Promise.resolve(); });
    expect(mockPersistShownHints).toHaveBeenCalledWith(['remaining_cell_locator']);
    await act(async () => { renderer.unmount(); });
  });
});
