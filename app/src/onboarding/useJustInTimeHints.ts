import { useCallback, useEffect, useRef, useState } from 'react';
import {
  reduceJustInTimeHints,
  type HintId,
  type JustInTimeHintEvent,
  type JustInTimeHintState,
} from './justInTimeHints';
import { getStartupOnboardingState, persistShownHints } from './state';
import { subscribeToTutorialEvents } from './tutorialEvents';
import type { TutorialDomainEvent } from './tutorialEngine';
import { tutorialHintShown } from '../analytics/onboarding';

export const LOCATOR_HINT_IDLE_MS = 10_000;

interface Options {
  readonly mandatoryBeatInFlight: boolean;
  readonly activeColorHasRemainingCells: boolean;
}

function isHintEvent(event: TutorialDomainEvent): event is JustInTimeHintEvent {
  return event.type === 'pinch_observed'
    || event.type === 'plain_drag_without_stitch_observed'
    || event.type === 'edge_auto_pan_engaged'
    || event.type === 'locator_idle_observed';
}

export function useJustInTimeHints({ mandatoryBeatInFlight, activeColorHasRemainingCells }: Options) {
  const startup = getStartupOnboardingState();
  const stateRef = useRef<JustInTimeHintState>({ shownHints: startup.shownHints });
  const optionsRef = useRef({ mandatoryBeatInFlight, activeColorHasRemainingCells });
  optionsRef.current = { mandatoryBeatInFlight, activeColorHasRemainingCells };
  const [visibleHint, setVisibleHint] = useState<HintId | null>(null);
  const [stitchEpoch, setStitchEpoch] = useState(0);

  const process = useCallback(async (event: JustInTimeHintEvent) => {
    const transition = reduceJustInTimeHints(
      stateRef.current,
      event,
      optionsRef.current.mandatoryBeatInFlight,
    );
    if (transition.state === stateRef.current) return;

    const previous = stateRef.current;
    stateRef.current = transition.state;
    try {
      await persistShownHints(transition.state.shownHints);
      const effect = transition.effects.find((candidate) => candidate.type === 'show_hint');
      if (effect?.type === 'show_hint') {
        setVisibleHint(effect.hintId);
        tutorialHintShown(effect.hintId, event.type);
      }
    } catch (error) {
      stateRef.current = previous;
      throw error;
    }
  }, []);

  useEffect(() => subscribeToTutorialEvents(async (event) => {
    if (event.type === 'completed_stitch_recorded') {
      setStitchEpoch((epoch) => epoch + 1);
      return;
    }
    if (isHintEvent(event)) await process(event);
  }), [process]);

  useEffect(() => {
    if (mandatoryBeatInFlight || !activeColorHasRemainingCells) return;
    const timer = setTimeout(() => {
      void process({ type: 'locator_idle_observed' }).catch((error) => {
        console.warn('Failed to save remaining-cell locator hint:', error);
      });
    }, LOCATOR_HINT_IDLE_MS);
    return () => clearTimeout(timer);
  }, [activeColorHasRemainingCells, mandatoryBeatInFlight, process, stitchEpoch]);

  return {
    visibleHint,
    dismissHint: useCallback(() => setVisibleHint(null), []),
  };
}
