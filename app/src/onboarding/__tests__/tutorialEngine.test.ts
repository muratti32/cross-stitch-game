import {
  initialTutorialEffects,
  MISMATCHED_TAP_BEAT_ID,
  reduceTutorial,
  STITCH_ACTION_BEAT_ID,
  THREAD_PALETTE_BEAT_ID,
  UNDO_ACTION_BEAT_ID,
  type TutorialState,
} from '../tutorialEngine';

const running: TutorialState = { runState: 'running', nextBeat: 1, completedBeats: [] };

describe('tutorial reducer beat 1', () => {
  it('shows one coach mark and ignores unrelated color changes', () => {
    expect(initialTutorialEffects(running)).toEqual([
      { type: 'clear_active_thread_color' },
      { type: 'show_coach_mark', beatId: THREAD_PALETTE_BEAT_ID },
    ]);
    expect(reduceTutorial(running, {
      type: 'active_thread_color_changed', dmcCode: '310',
    })).toEqual({ state: running, effects: [] });
  });

  it('advances only after the highlighted active color is observed', () => {
    const result = reduceTutorial(running, {
      type: 'active_thread_color_changed', dmcCode: '321',
    });
    expect(result.state).toEqual({
      runState: 'running', nextBeat: 2, completedBeats: [THREAD_PALETTE_BEAT_ID],
    });
    expect(result.effects).toEqual([
      { type: 'release_focus' },
      { type: 'persist', state: result.state, observedActiveDmcCode: '321' },
      { type: 'acquire_focus', target: 'matching_cell' },
      { type: 'show_coach_mark', beatId: STITCH_ACTION_BEAT_ID },
    ]);
  });

  it('pauses without changing the beat cursor', () => {
    const result = reduceTutorial(running, { type: 'skip_requested' });
    expect(result.state).toEqual({ ...running, runState: 'paused' });
    expect(result.effects).toEqual([{ type: 'persist', state: result.state }]);
  });

  it('keeps the advanced cursor stable through a later color change', () => {
    const selected = reduceTutorial(running, {
      type: 'active_thread_color_changed', dmcCode: '321',
    });
    const laterSkip = reduceTutorial(selected.state, { type: 'active_thread_color_changed', dmcCode: '321' });

    expect(laterSkip).toEqual({ state: selected.state, effects: [] });
  });

  it('does nothing after pause or beat completion', () => {
    const paused = { ...running, runState: 'paused' as const };
    expect(reduceTutorial(paused, { type: 'active_thread_color_changed', dmcCode: '321' }))
      .toEqual({ state: paused, effects: [] });
  });
});

describe('tutorial reducer beats 2 through 4', () => {
  it('advances beat 2 only after a recorded completed stitch and acquires then releases focus', () => {
    const state: TutorialState = { runState: 'running', nextBeat: 2, completedBeats: [THREAD_PALETTE_BEAT_ID] };
    expect(initialTutorialEffects(state)).toEqual([
      { type: 'acquire_focus', target: 'matching_cell' },
      { type: 'show_coach_mark', beatId: STITCH_ACTION_BEAT_ID },
    ]);
    expect(reduceTutorial(state, { type: 'mismatched_tap_observed' }).state.nextBeat).toBe(2);
    const result = reduceTutorial(state, { type: 'completed_stitch_recorded', cellIndex: 12 });
    expect(result.state.nextBeat).toBe(3);
    expect(result.effects).toContainEqual({ type: 'release_focus' });
    expect(result.effects).toContainEqual({ type: 'acquire_focus', target: 'non_matching_cell' });
  });

  it('advances beat 3 on a mismatched tap and remembers an early mismatched tap', () => {
    const state: TutorialState = { runState: 'running', nextBeat: 3, completedBeats: [THREAD_PALETTE_BEAT_ID, STITCH_ACTION_BEAT_ID] };
    const result = reduceTutorial(state, { type: 'mismatched_tap_observed' });
    expect(result.state).toMatchObject({ nextBeat: 4, completedBeats: expect.arrayContaining([MISMATCHED_TAP_BEAT_ID]) });

    const early = reduceTutorial(running, { type: 'mismatched_tap_observed' });
    expect(early.state.completedBeats).toContain(MISMATCHED_TAP_BEAT_ID);
    const afterPalette = reduceTutorial(early.state, { type: 'active_thread_color_changed', dmcCode: '321' });
    expect(afterPalette.state.nextBeat).toBe(2);
  });

  it('advances beat 4 only after an incomplete operation is followed by a completed operation for that cell', () => {
    const state: TutorialState = { runState: 'running', nextBeat: 4, completedBeats: [THREAD_PALETTE_BEAT_ID, STITCH_ACTION_BEAT_ID, MISMATCHED_TAP_BEAT_ID] };
    const undone = reduceTutorial(state, { type: 'progress_operation_recorded', desiredState: 'incomplete', cellIndex: 7 });
    expect(undone.state.undoneCellIndex).toBe(7);
    expect(reduceTutorial(undone.state, { type: 'progress_operation_recorded', desiredState: 'completed', cellIndex: 8 }).state.nextBeat).toBe(4);
    const result = reduceTutorial(undone.state, { type: 'progress_operation_recorded', desiredState: 'completed', cellIndex: 7 });
    expect(result.state).toMatchObject({ nextBeat: 5, undoneCellIndex: undefined, completedBeats: expect.arrayContaining([UNDO_ACTION_BEAT_ID]) });
  });
});
