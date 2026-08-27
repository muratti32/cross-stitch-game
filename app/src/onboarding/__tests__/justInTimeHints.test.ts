import { reduceJustInTimeHints, type JustInTimeHintState } from '../justInTimeHints';

const initial: JustInTimeHintState = { shownHints: [] };

describe('just-in-time hint reducer', () => {
  it.each([
    ['pinch_observed', 'anchored_zoom'],
    ['plain_drag_without_stitch_observed', 'pan_vs_sweep'],
    ['edge_auto_pan_engaged', 'edge_auto_pan'],
    ['locator_idle_observed', 'remaining_cell_locator'],
  ] as const)('shows %s as %s once', (type, hintId) => {
    const result = reduceJustInTimeHints(initial, { type }, false);
    expect(result.effects).toEqual([
      { type: 'persist_shown_hints', shownHints: [hintId] },
      { type: 'show_hint', hintId },
    ]);
    expect(reduceJustInTimeHints(result.state, { type }, false)).toEqual({ state: result.state, effects: [] });
  });

  it('suppresses every hint while a mandatory beat is active', () => {
    expect(reduceJustInTimeHints(initial, { type: 'pinch_observed' }, true))
      .toEqual({ state: initial, effects: [] });
  });
});
