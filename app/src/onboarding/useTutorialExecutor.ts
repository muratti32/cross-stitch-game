import { useCallback, useEffect, useRef, useState } from 'react';
import { getStartupOnboardingState, persistTutorialTransition } from './state';
import { subscribeToTutorialEvents, emitTutorialEvent } from './tutorialEvents';
import { reduceTutorial, type TutorialState } from './tutorialEngine';

export function useTutorialExecutor(sessionId: string | undefined) {
  const startup = getStartupOnboardingState();
  const enabled = Boolean(
    sessionId
    && startup.position === 'in_tutorial'
    && startup.tutorialSessionId === sessionId,
  );
  const initial: TutorialState = {
    runState: startup.tutorialRunState,
    nextBeat: startup.nextBeat,
    completedBeats: startup.completedBeats,
  };
  const stateRef = useRef(initial);
  const [state, setState] = useState(initial);

  useEffect(() => {
    if (!enabled) return;
    return subscribeToTutorialEvents((event) => {
      const transition = reduceTutorial(stateRef.current, event);
      if (transition.state !== stateRef.current) {
        stateRef.current = transition.state;
        setState(transition.state);
      }
      for (const effect of transition.effects) {
        if (effect.type === 'persist') {
          void persistTutorialTransition({
            tutorialRunState: effect.state.runState,
            nextBeat: effect.state.nextBeat,
            completedBeats: effect.state.completedBeats,
          }, effect.observedActiveDmcCode).catch((error) => {
            console.warn('Failed to persist tutorial transition:', error);
          });
        }
      }
    });
  }, [enabled]);

  const skip = useCallback(() => emitTutorialEvent({ type: 'skip_requested' }), []);
  return { showThreadPaletteBeat: enabled && state.runState === 'running' && state.nextBeat === 1, skip };
}
