import { useCallback, useEffect, useRef, useState } from 'react';
import { getStartupOnboardingState, persistTutorialTransition } from './state';
import { subscribeToTutorialEvents, emitTutorialEvent } from './tutorialEvents';
import { initialTutorialEffects, reduceTutorial, type TutorialFocusTarget, type TutorialState } from './tutorialEngine';
import { onboardingFinished, tutorialBeatCompleted, tutorialBeatStarted, tutorialPaused, tutorialResumed } from '../analytics/onboarding';

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
    lastCompletedCellIndex: startup.lastCompletedCellIndex,
    threadColorCompletionObserved: startup.threadColorCompletionObserved,
  };
  const stateRef = useRef(initial);
  const [runState, setRunState] = useState(initial.runState);
  const initialEffects = useRef(initialTutorialEffects(initial)).current;
  const initialCoachMark = initialEffects.find((effect) => effect.type === 'show_coach_mark');
  const [coachMarkBeat, setCoachMarkBeat] = useState(
    initialCoachMark?.type === 'show_coach_mark' ? initialCoachMark.beatId : null,
  );
  const [recapVisible, setRecapVisible] = useState(false);
  const callbacksRef = useRef(callbacks);
  const beatStartedAtRef = useRef(Date.now());
  const beatAttemptsRef = useRef(0);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!enabled) return;
    if (initial.nextBeat <= 6) tutorialBeatStarted(['', 'thread_palette', 'stitch_action', 'mismatched_tap', 'undo_action', 'stitch_sweep', 'thread_color_completion'][initial.nextBeat] ?? '', initial.nextBeat);
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
      if (event.type === 'skip_requested') tutorialPaused(String(previousState.nextBeat), 'session');
      if (event.type === 'resume_requested') tutorialResumed(String(previousState.nextBeat), 'session');
      if (event.type === 'completed_stitch_recorded' || event.type === 'mismatched_tap_observed' || event.type === 'progress_operation_recorded') beatAttemptsRef.current += 1;
      if (transition.state.nextBeat !== previousState.nextBeat && previousState.nextBeat <= 6) {
        const ids = ['', 'thread_palette', 'stitch_action', 'mismatched_tap', 'undo_action', 'stitch_sweep', 'thread_color_completion'];
        const completedBeat = ids[previousState.nextBeat];
        if (completedBeat) tutorialBeatCompleted(completedBeat, Date.now() - beatStartedAtRef.current, beatAttemptsRef.current, false);
        beatAttemptsRef.current = 0;
        beatStartedAtRef.current = Date.now();
        if (transition.state.nextBeat <= 6) tutorialBeatStarted(ids[transition.state.nextBeat], transition.state.nextBeat);
      }
      if (transition.effects.some((effect) => effect.type === 'open_recap')) onboardingFinished('completed', 'stitching', 0, 0);

      try {
        for (const effect of transition.effects) {
          if (effect.type === 'persist') {
            await persistTutorialTransition({
              tutorialRunState: effect.state.runState,
              nextBeat: effect.state.nextBeat,
              completedBeats: effect.state.completedBeats,
              undoneCellIndex: effect.state.undoneCellIndex,
              lastCompletedCellIndex: effect.state.lastCompletedCellIndex,
              threadColorCompletionObserved: effect.state.threadColorCompletionObserved,
            }, effect.observedActiveDmcCode);
          }
          if (effect.type === 'clear_active_thread_color') {
            callbacksRef.current.clearActiveThreadColor();
          }
        }
        setRunState(transition.state.runState);
        const coachMark = transition.effects.find((effect) => effect.type === 'show_coach_mark');
        setCoachMarkBeat(coachMark?.type === 'show_coach_mark' ? coachMark.beatId : null);
        if (transition.effects.some((effect) => effect.type === 'open_recap')) setRecapVisible(true);
        for (const effect of transition.effects) {
          if (effect.type === 'acquire_focus') callbacksRef.current.acquireFocus(effect.target);
          if (effect.type === 'release_focus') callbacksRef.current.releaseFocus();
        }
       } catch (error) {
         stateRef.current = previousState;
        setRunState(previousState.runState);
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
  const resume = useCallback(() => {
    void emitTutorialEvent({ type: 'resume_requested' }).catch((error) => {
      console.warn('Failed to resume tutorial:', error);
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
    canResume: enabled && runState === 'paused',
    recapVisible: enabled && recapVisible,
    dismissRecap: () => setRecapVisible(false),
    selectThreadColor,
    skip,
    resume,
  };
}
