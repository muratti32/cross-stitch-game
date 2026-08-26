import { useCallback, useEffect, useRef, useState } from 'react';
import { getStartupOnboardingState, persistTutorialTransition } from './state';
import { subscribeToTutorialEvents, emitTutorialEvent } from './tutorialEvents';
import { reduceTutorial, type TutorialState } from './tutorialEngine';

interface ExecutorCallbacks {
  readonly clearActiveThreadColor: () => void;
  readonly applyActiveThreadColor: (index: number) => void;
}

export function useTutorialExecutor(
  sessionId: string | undefined,
  callbacks: ExecutorCallbacks,
) {
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
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (enabled && initial.runState === 'running' && initial.nextBeat === 1) {
      callbacksRef.current.clearActiveThreadColor();
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeToTutorialEvents(async (event) => {
      const transition = reduceTutorial(stateRef.current, event);
      for (const effect of transition.effects) {
        if (effect.type === 'persist') {
          await persistTutorialTransition({
            tutorialRunState: effect.state.runState,
            nextBeat: effect.state.nextBeat,
            completedBeats: effect.state.completedBeats,
          }, effect.observedActiveDmcCode);
        }
      }
      if (transition.state !== stateRef.current) {
        stateRef.current = transition.state;
        setState(transition.state);
      }
    });
  }, [enabled]);

  const skip = useCallback(() => {
    void emitTutorialEvent({ type: 'skip_requested' }).catch((error) => {
      console.warn('Failed to pause tutorial:', error);
    });
  }, []);
  const selectThreadColor = useCallback(async (index: number, dmcCode: string) => {
    try {
      await emitTutorialEvent({ type: 'active_thread_color_changed', dmcCode });
      callbacksRef.current.applyActiveThreadColor(index);
    } catch (error) {
      console.warn('Failed to save tutorial color selection:', error);
    }
  }, []);
  return {
    showThreadPaletteBeat: enabled && state.runState === 'running' && state.nextBeat === 1,
    selectThreadColor,
    skip,
  };
}
