import { useCallback, useEffect, useRef, useState } from 'react';
import { getStartupOnboardingState, persistTutorialTransition } from './state';
import { subscribeToTutorialEvents, emitTutorialEvent } from './tutorialEvents';
import { initialTutorialEffects, reduceTutorial, type TutorialState } from './tutorialEngine';

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
  const initialEffects = useRef(initialTutorialEffects(initial)).current;
  const [coachMarkVisible, setCoachMarkVisible] = useState(
    initialEffects.some((effect) => effect.type === 'show_coach_mark'),
  );
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!enabled) return;
    for (const effect of initialEffects) {
      if (effect.type === 'clear_active_thread_color') {
        callbacksRef.current.clearActiveThreadColor();
      }
    }
  }, [enabled, initialEffects]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeToTutorialEvents(async (event) => {
      const transition = reduceTutorial(stateRef.current, event);
      if (transition.state === stateRef.current) return;

      const previousState = stateRef.current;
      stateRef.current = transition.state;
      setCoachMarkVisible(
        transition.effects.some((effect) => effect.type === 'show_coach_mark'),
      );

      for (const effect of transition.effects) {
        if (effect.type === 'persist') {
          try {
            await persistTutorialTransition({
              tutorialRunState: effect.state.runState,
              nextBeat: effect.state.nextBeat,
              completedBeats: effect.state.completedBeats,
            }, effect.observedActiveDmcCode);
          } catch (error) {
            stateRef.current = previousState;
            setCoachMarkVisible(
              initialTutorialEffects(previousState).some((previousEffect) => previousEffect.type === 'show_coach_mark'),
            );
            throw error;
          }
        }
      }
    });
  }, [enabled]);

  const skip = useCallback(() => {
    void emitTutorialEvent({ type: 'skip_requested' }).catch((error) => {
      console.warn('Failed to pause tutorial:', error);
    });
  }, []);
  const selectThreadColor = useCallback(async (
    index: number,
    previousIndex: number,
    dmcCode: string,
  ) => {
    callbacksRef.current.applyActiveThreadColor(index);
    try {
      await emitTutorialEvent({ type: 'active_thread_color_changed', dmcCode });
    } catch (error) {
      callbacksRef.current.applyActiveThreadColor(previousIndex);
      console.warn('Failed to save tutorial color selection:', error);
    }
  }, []);
  return {
    showThreadPaletteBeat: enabled && coachMarkVisible,
    activeDmcCode: enabled ? startup.activeDmcCode : null,
    selectThreadColor,
    skip,
  };
}
