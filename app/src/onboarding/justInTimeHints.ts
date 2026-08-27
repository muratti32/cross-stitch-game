export const HINT_IDS = ['anchored_zoom', 'pan_vs_sweep', 'edge_auto_pan', 'remaining_cell_locator'] as const;
export type HintId = (typeof HINT_IDS)[number];

export interface JustInTimeHintState {
  readonly shownHints: readonly HintId[];
}

export type JustInTimeHintEvent =
  | { readonly type: 'pinch_observed' }
  | { readonly type: 'plain_drag_without_stitch_observed' }
  | { readonly type: 'edge_auto_pan_engaged' }
  | { readonly type: 'locator_idle_observed' };

export type JustInTimeHintEffect =
  | { readonly type: 'show_hint'; readonly hintId: HintId }
  | { readonly type: 'persist_shown_hints'; readonly shownHints: readonly HintId[] };

export interface JustInTimeHintTransition {
  readonly state: JustInTimeHintState;
  readonly effects: readonly JustInTimeHintEffect[];
}

const EVENT_HINTS: Record<JustInTimeHintEvent['type'], HintId> = {
  pinch_observed: 'anchored_zoom',
  plain_drag_without_stitch_observed: 'pan_vs_sweep',
  edge_auto_pan_engaged: 'edge_auto_pan',
  locator_idle_observed: 'remaining_cell_locator',
};

export function reduceJustInTimeHints(
  state: JustInTimeHintState,
  event: JustInTimeHintEvent,
  mandatoryBeatInFlight: boolean,
): JustInTimeHintTransition {
  const hintId = EVENT_HINTS[event.type];
  if (mandatoryBeatInFlight || state.shownHints.includes(hintId)) return { state, effects: [] };

  const shownHints = [...state.shownHints, hintId];
  return {
    state: { shownHints },
    effects: [
      { type: 'persist_shown_hints', shownHints },
      { type: 'show_hint', hintId },
    ],
  };
}
