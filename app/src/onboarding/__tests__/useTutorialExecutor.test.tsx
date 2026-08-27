import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockPersistTutorialTransition = jest.fn();

jest.mock('../state', () => ({
  getStartupOnboardingState: () => ({
    position: 'in_tutorial',
    tutorialRunState: 'running',
    tutorialSessionId: 'session-heart',
    nextBeat: 1,
    completedBeats: [],
    activeDmcCode: null,
  }),
  persistTutorialTransition: (...args: unknown[]) => mockPersistTutorialTransition(...args),
}));

import { useTutorialExecutor } from '../useTutorialExecutor';

describe('tutorial executor', () => {
  it('does not render the next coach-mark state before its cursor is durable', async () => {
    let releasePersistence!: () => void;
    mockPersistTutorialTransition.mockImplementation(() => new Promise<void>((resolve) => {
      releasePersistence = resolve;
    }));
    const applyActiveThreadColor = jest.fn();
    let tutorial!: ReturnType<typeof useTutorialExecutor>;

    function Harness() {
      tutorial = useTutorialExecutor('session-heart', {
        clearActiveThreadColor: jest.fn(),
        applyActiveThreadColor,
        acquireFocus: jest.fn(),
        releaseFocus: jest.fn(),
      });
      return null;
    }

    await act(async () => {
      TestRenderer.create(<Harness />);
    });
    expect(tutorial.showThreadPaletteBeat).toBe(true);

    const selection = tutorial.selectThreadColor(0, -1, '321');
    await act(async () => {
      await Promise.resolve();
    });
    expect(applyActiveThreadColor).toHaveBeenCalledWith(0);
    expect(mockPersistTutorialTransition).toHaveBeenCalledTimes(1);
    expect(tutorial.showThreadPaletteBeat).toBe(true);

    await act(async () => {
      releasePersistence();
      await selection;
    });
    expect(tutorial.showThreadPaletteBeat).toBe(false);
  });
});
