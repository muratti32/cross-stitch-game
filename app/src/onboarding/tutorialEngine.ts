export const THREAD_PALETTE_BEAT_ID = 'thread_palette';
export const STITCH_ACTION_BEAT_ID = 'stitch_action';
export const MISMATCHED_TAP_BEAT_ID = 'mismatched_tap';
export const UNDO_ACTION_BEAT_ID = 'undo_action';
export const TUTORIAL_HIGHLIGHT_DMC = '321';

const BEAT_IDS = [THREAD_PALETTE_BEAT_ID, STITCH_ACTION_BEAT_ID, MISMATCHED_TAP_BEAT_ID, UNDO_ACTION_BEAT_ID] as const;
export type TutorialFocusTarget = 'matching_cell' | 'non_matching_cell';

export interface TutorialState {
  readonly runState: 'running' | 'paused' | 'complete';
  readonly nextBeat: number;
  readonly completedBeats: readonly string[];
  readonly undoneCellIndex?: number;
  readonly lastCompletedCellIndex?: number;
}

export type TutorialDomainEvent =
  | { readonly type: 'active_thread_color_changed'; readonly dmcCode: string }
  | { readonly type: 'completed_stitch_recorded'; readonly cellIndex: number; readonly targeted: boolean }
  | { readonly type: 'mismatched_tap_observed'; readonly targeted: boolean }
  | { readonly type: 'progress_operation_recorded'; readonly desiredState: 'completed' | 'incomplete'; readonly cellIndex: number }
  | { readonly type: 'skip_requested' };

export type TutorialEffect =
  | { readonly type: 'clear_active_thread_color' }
  | { readonly type: 'show_coach_mark'; readonly beatId: (typeof BEAT_IDS)[number] }
  | { readonly type: 'acquire_focus'; readonly target: TutorialFocusTarget }
  | { readonly type: 'release_focus' }
  | { readonly type: 'persist'; readonly state: TutorialState; readonly observedActiveDmcCode?: string };

export interface TutorialTransition { readonly state: TutorialState; readonly effects: readonly TutorialEffect[]; }

function beatEffects(nextBeat: number): readonly TutorialEffect[] {
  const beatId = BEAT_IDS[nextBeat - 1];
  if (!beatId) return [];
  const target: TutorialFocusTarget | null = nextBeat === 2
    ? 'matching_cell'
    : nextBeat === 3 ? 'non_matching_cell' : null;
  return [...(target ? [{ type: 'acquire_focus' as const, target }] : []), { type: 'show_coach_mark', beatId }];
}

export function initialTutorialEffects(state: TutorialState): readonly TutorialEffect[] {
  if (state.runState !== 'running' || state.nextBeat > BEAT_IDS.length) return [];
  return state.nextBeat === 1 ? [{ type: 'clear_active_thread_color' }, ...beatEffects(1)] : beatEffects(state.nextBeat);
}

function learned(state: TutorialState, beatId: string): TutorialState {
  return state.completedBeats.includes(beatId) ? state : { ...state, completedBeats: [...state.completedBeats, beatId] };
}

function skipLearned(state: TutorialState): TutorialState {
  let nextBeat = state.nextBeat;
  while (nextBeat <= BEAT_IDS.length && state.completedBeats.includes(BEAT_IDS[nextBeat - 1])) nextBeat++;
  return nextBeat === state.nextBeat ? state : { ...state, nextBeat };
}

function transition(state: TutorialState, nextState: TutorialState, observedActiveDmcCode?: string): TutorialTransition {
  if (nextState === state) return { state, effects: [] };
  const effects: TutorialEffect[] = [];
  if (state.nextBeat !== nextState.nextBeat || state.runState !== nextState.runState) {
    effects.push({ type: 'release_focus' });
  }
  effects.push({
    type: 'persist',
    state: nextState,
    ...(observedActiveDmcCode ? { observedActiveDmcCode } : {}),
  });
  if (nextState.runState === 'running') effects.push(...beatEffects(nextState.nextBeat));
  return { state: nextState, effects };
}

export function reduceTutorial(state: TutorialState, event: TutorialDomainEvent): TutorialTransition {
  if (state.runState !== 'running') return { state, effects: [] };
  if (event.type === 'skip_requested') return transition(state, { ...state, runState: 'paused' });
  if (event.type === 'active_thread_color_changed') {
    if (state.nextBeat !== 1 || event.dmcCode !== TUTORIAL_HIGHLIGHT_DMC) return { state, effects: [] };
    return transition(state, skipLearned(learned({ ...state, nextBeat: 2 }, THREAD_PALETTE_BEAT_ID)), event.dmcCode);
  }
  if (event.type === 'completed_stitch_recorded') {
    if (state.nextBeat === 2 && !event.targeted) return { state, effects: [] };
    let next = learned({ ...state, lastCompletedCellIndex: event.cellIndex }, STITCH_ACTION_BEAT_ID);
    if (state.nextBeat === 2) next = { ...next, nextBeat: 3 };
    return transition(state, skipLearned(next));
  }
  if (event.type === 'mismatched_tap_observed') {
    if (state.nextBeat === 3 && !event.targeted) return { state, effects: [] };
    let next = learned(state, MISMATCHED_TAP_BEAT_ID);
    if (state.nextBeat === 3) next = { ...next, nextBeat: 4 };
    return transition(state, skipLearned(next));
  }
  if (event.desiredState === 'incomplete') {
    return event.cellIndex === state.lastCompletedCellIndex
      ? transition(state, { ...state, undoneCellIndex: event.cellIndex })
      : { state, effects: [] };
  }
  if (state.undoneCellIndex !== event.cellIndex) return { state, effects: [] };
  let next = learned({ ...state, undoneCellIndex: undefined }, UNDO_ACTION_BEAT_ID);
  if (state.nextBeat === 4) next = { ...next, nextBeat: 5 };
  return transition(state, skipLearned(next));
}
