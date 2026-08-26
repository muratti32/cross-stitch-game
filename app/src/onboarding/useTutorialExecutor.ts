import { useCallback, useEffect, useRef, useState } from 'react';
import { getStartupOnboardingState, persistTutorialTransition } from './state';
import { subscribeToTutorialEvents, emitTutorialEvent } from './tutorialEvents';
import { initialTutorialEffects, reduceTutorial, type TutorialFocusTarget, type TutorialState } from './tutorialEngine';

interface ExecutorCallbacks {
  readonly clearActiveThreadColor: () => void;
  readonly applyActiveThreadColor: (index: number) => void;
  readonly acquireFocus: (target: TutorialFocusTarget) => void;
  readonly releaseFocus: () => void;
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
    undoneCellIndex: startup.undoneCellIndex,
  };
  const stateRef = useRef(initial);
  const initialEffects = useRef(initialTutorialEffects(initial)).current;
  const initialCoachMark = initialEffects.find((effect) => effect.type === 'show_coach_mark');
  const [coachMarkBeat, setCoachMarkBeat] = useState(
    initialCoachMark?.type === 'show_coach_mark' ? initialCoachMark.beatId : null,
  );
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!enabled) return;
    for (const effect of initialEffects) {
      if (effect.type === 'clear_active_thread_color') {
        callbacksRef.current.clearActiveThreadColor();
      } else if (effect.type === 'acquire_focus') {
        callbacksRef.current.acquireFocus(effect.target);
      } else if (effect.type === 'release_focus') {
        callbacksRef.current.releaseFocus();
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

      try {
        for (const effect of transition.effects) {
          if (effect.type === 'persist') {
            await persistTutorialTransition({
              tutorialRunState: effect.state.runState,
              nextBeat: effect.state.nextBeat,
              completedBeats: effect.state.completedBeats,
              undoneCellIndex: effect.state.undoneCellIndex,
            }, effect.observedActiveDmcCode);
          }
        }
        const coachMark = transition.effects.find((effect) => effect.type === 'show_coach_mark');
        setCoachMarkBeat(coachMark?.type === 'show_coach_mark' ? coachMark.beatId : null);
        for (const effect of transition.effects) {
          if (effect.type === 'acquire_focus') callbacksRef.current.acquireFocus(effect.target);
          if (effect.type === 'release_focus') callbacksRef.current.releaseFocus();
        }
      } catch (error) {
        stateRef.current = previousState;
        const previousCoachMark = initialTutorialEffects(previousState).find((effect) => effect.type === 'show_coach_mark');
        setCoachMarkBeat(previousCoachMark?.type === 'show_coach_mark' ? previousCoachMark.beatId : null);
        throw error;
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
    coachMarkBeat: enabled ? coachMarkBeat : null,
    showThreadPaletteBeat: enabled && coachMarkBeat === 'thread_palette',
    activeDmcCode: enabled ? startup.activeDmcCode : null,
    selectThreadColor,
    skip,
  };
}
