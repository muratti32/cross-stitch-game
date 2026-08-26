export const THREAD_PALETTE_BEAT_ID = 'thread_palette';
export const TUTORIAL_HIGHLIGHT_DMC = '321';

export interface TutorialState {
  readonly runState: 'running' | 'paused' | 'complete';
  readonly nextBeat: number;
  readonly completedBeats: readonly string[];
}

export type TutorialDomainEvent =
  | { readonly type: 'active_thread_color_changed'; readonly dmcCode: string }
  | { readonly type: 'skip_requested' };

export type TutorialEffect =
  | { readonly type: 'clear_active_thread_color' }
  | { readonly type: 'show_coach_mark'; readonly beatId: typeof THREAD_PALETTE_BEAT_ID }
  | {
      readonly type: 'persist';
      readonly state: TutorialState;
      readonly observedActiveDmcCode?: string;
    };

export interface TutorialTransition {
  readonly state: TutorialState;
  readonly effects: readonly TutorialEffect[];
}

export function initialTutorialEffects(state: TutorialState): readonly TutorialEffect[] {
  return state.runState === 'running' && state.nextBeat === 1
    ? [
        { type: 'clear_active_thread_color' },
        { type: 'show_coach_mark', beatId: THREAD_PALETTE_BEAT_ID },
      ]
    : [];
}

export function reduceTutorial(
  state: TutorialState,
  event: TutorialDomainEvent,
): TutorialTransition {
  if (state.runState !== 'running' || state.nextBeat !== 1) {
    return { state, effects: [] };
  }

  if (event.type === 'skip_requested') {
    const nextState = { ...state, runState: 'paused' as const };
    return { state: nextState, effects: [{ type: 'persist', state: nextState }] };
  }

  if (event.dmcCode !== TUTORIAL_HIGHLIGHT_DMC) {
    return { state, effects: [] };
  }

  const nextState = {
    runState: state.runState,
    nextBeat: 2,
    completedBeats: [...new Set([...state.completedBeats, THREAD_PALETTE_BEAT_ID])],
  };
  return {
    state: nextState,
    effects: [{ type: 'persist', state: nextState, observedActiveDmcCode: event.dmcCode }],
  };
}
