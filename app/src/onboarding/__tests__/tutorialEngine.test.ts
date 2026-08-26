import {
  initialTutorialEffects,
  MISMATCHED_TAP_BEAT_ID,
  reduceTutorial,
  STITCH_SWEEP_BEAT_ID,
  STITCH_ACTION_BEAT_ID,
  THREAD_PALETTE_BEAT_ID,
  THREAD_COLOR_COMPLETION_BEAT_ID,
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
    expect(result.effects).toEqual([
      { type: 'release_focus' },
      { type: 'persist', state: result.state },
    ]);
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

  it('resumes at the stored cursor without restarting beat one', () => {
    const paused: TutorialState = {
      runState: 'paused', nextBeat: 2, completedBeats: [THREAD_PALETTE_BEAT_ID],
    };
    const result = reduceTutorial(paused, { type: 'resume_requested' });
    expect(result.state).toEqual({ ...paused, runState: 'running' });
    expect(result.effects).toEqual(expect.arrayContaining([
      { type: 'persist', state: result.state },
      { type: 'acquire_focus', target: 'matching_cell' },
      { type: 'show_coach_mark', beatId: STITCH_ACTION_BEAT_ID },
    ]));
  });
});

describe('tutorial reducer beat 5', () => {
  const sweepState: TutorialState = {
    runState: 'running',
    nextBeat: 5,
    completedBeats: [THREAD_PALETTE_BEAT_ID, STITCH_ACTION_BEAT_ID, MISMATCHED_TAP_BEAT_ID, UNDO_ACTION_BEAT_ID],
  };

  it('advances only after three recorded stitches share one sweep gesture identity', () => {
    const first = reduceTutorial(sweepState, {
      type: 'completed_stitch_recorded', cellIndex: 20, targeted: true, sweepGestureId: 41,
    });
    const second = reduceTutorial(first.state, {
      type: 'completed_stitch_recorded', cellIndex: 21, targeted: true, sweepGestureId: 41,
    });
    const result = reduceTutorial(second.state, {
      type: 'completed_stitch_recorded', cellIndex: 22, targeted: true, sweepGestureId: 41,
    });

    expect(initialTutorialEffects(sweepState)).toEqual([
      { type: 'acquire_focus', target: 'sweep_run' },
      { type: 'show_coach_mark', beatId: STITCH_SWEEP_BEAT_ID },
    ]);
    expect(result.state).toMatchObject({
      nextBeat: 6,
      activeSweepGestureId: 41,
      activeSweepStitchCount: 3,
      completedBeats: expect.arrayContaining([STITCH_SWEEP_BEAT_ID]),
    });
  });

  it('does not advance for three taps or stitches split across gestures', () => {
    let taps = sweepState;
    for (const cellIndex of [20, 21, 22]) {
      taps = reduceTutorial(taps, { type: 'completed_stitch_recorded', cellIndex, targeted: true }).state;
    }
    expect(taps.completedBeats).not.toContain(STITCH_SWEEP_BEAT_ID);
    expect(taps.nextBeat).toBe(5);

    const first = reduceTutorial(sweepState, {
      type: 'completed_stitch_recorded', cellIndex: 20, targeted: true, sweepGestureId: 1,
    });
    const second = reduceTutorial(first.state, {
      type: 'completed_stitch_recorded', cellIndex: 21, targeted: true, sweepGestureId: 2,
    });
    const split = reduceTutorial(second.state, {
      type: 'completed_stitch_recorded', cellIndex: 22, targeted: true, sweepGestureId: 3,
    });
    expect(split.state.completedBeats).not.toContain(STITCH_SWEEP_BEAT_ID);
    expect(split.state.nextBeat).toBe(5);
  });
});

describe('tutorial reducer beat 6', () => {
  const beatSix: TutorialState = {
    runState: 'running',
    nextBeat: 6,
    completedBeats: [THREAD_PALETTE_BEAT_ID, STITCH_ACTION_BEAT_ID, MISMATCHED_TAP_BEAT_ID, UNDO_ACTION_BEAT_ID, STITCH_SWEEP_BEAT_ID],
  };

  it('waits for a thread completion and a later explicit color selection before opening the recap', () => {
    expect(initialTutorialEffects(beatSix)).toContainEqual({ type: 'show_coach_mark', beatId: THREAD_COLOR_COMPLETION_BEAT_ID });
    const completedColor = reduceTutorial(beatSix, { type: 'thread_color_completed', dmcCode: 'white' });
    const result = reduceTutorial(completedColor.state, { type: 'active_thread_color_changed', dmcCode: '310' });

    expect(result.state).toMatchObject({ runState: 'complete', nextBeat: 7 });
    expect(result.state.completedBeats).toContain(THREAD_COLOR_COMPLETION_BEAT_ID);
    expect(result.effects).toContainEqual({ type: 'open_recap' });
  });

  it('accepts any thread color completion followed by any explicit color selection', () => {
    const completedColor = reduceTutorial(beatSix, { type: 'thread_color_completed', dmcCode: '321' });
    expect(reduceTutorial(completedColor.state, { type: 'active_thread_color_changed', dmcCode: '666' }).state.runState).toBe('complete');
  });

  it('does not carry an earlier thread completion into beat 6', () => {
    expect(reduceTutorial(running, { type: 'thread_color_completed', dmcCode: '321' }))
      .toEqual({ state: running, effects: [] });
  });

  it('force-completes an open tutorial when the session completes', () => {
    const result = reduceTutorial({ ...beatSix, runState: 'paused' }, { type: 'session_completed' });
    expect(result.state.runState).toBe('complete');
    expect(result.effects).toContainEqual({ type: 'open_recap' });
  });
});

describe('tutorial reducer beats 2 through 4', () => {
  it('advances beat 2 only after a recorded completed stitch and acquires then releases focus', () => {
    const state: TutorialState = { runState: 'running', nextBeat: 2, completedBeats: [THREAD_PALETTE_BEAT_ID] };
    expect(initialTutorialEffects(state)).toEqual([
      { type: 'acquire_focus', target: 'matching_cell' },
      { type: 'show_coach_mark', beatId: STITCH_ACTION_BEAT_ID },
    ]);
    expect(reduceTutorial(state, { type: 'completed_stitch_recorded', cellIndex: 11, targeted: false }))
      .toEqual({ state, effects: [] });
    const result = reduceTutorial(state, { type: 'completed_stitch_recorded', cellIndex: 12, targeted: true });
    expect(result.state.nextBeat).toBe(3);
    expect(result.effects).toContainEqual({ type: 'release_focus' });
    expect(result.effects).toContainEqual({ type: 'acquire_focus', target: 'non_matching_cell' });
  });

  it('releases the focused cell when a focused beat is skipped', () => {
    const state: TutorialState = { runState: 'running', nextBeat: 2, completedBeats: [THREAD_PALETTE_BEAT_ID] };
    expect(reduceTutorial(state, { type: 'skip_requested' }).effects).toContainEqual({ type: 'release_focus' });
  });

  it('advances beat 3 on a mismatched tap and remembers an early mismatched tap', () => {
    const state: TutorialState = { runState: 'running', nextBeat: 3, completedBeats: [THREAD_PALETTE_BEAT_ID, STITCH_ACTION_BEAT_ID] };
    const result = reduceTutorial(state, { type: 'mismatched_tap_observed', targeted: true });
    expect(result.state).toMatchObject({ nextBeat: 4, completedBeats: expect.arrayContaining([MISMATCHED_TAP_BEAT_ID]) });

    const early = reduceTutorial(running, { type: 'mismatched_tap_observed', targeted: false });
    expect(early.state.completedBeats).toContain(MISMATCHED_TAP_BEAT_ID);
    const afterPalette = reduceTutorial(early.state, { type: 'active_thread_color_changed', dmcCode: '321' });
    expect(afterPalette.state.nextBeat).toBe(2);
  });

  it('advances beat 4 only after an incomplete operation is followed by a completed operation for that cell', () => {
    const state: TutorialState = { runState: 'running', nextBeat: 4, completedBeats: [THREAD_PALETTE_BEAT_ID, STITCH_ACTION_BEAT_ID, MISMATCHED_TAP_BEAT_ID], lastCompletedCellIndex: 7 };
    const undone = reduceTutorial(state, { type: 'progress_operation_recorded', desiredState: 'incomplete', cellIndex: 7 });
    expect(undone.state.undoneCellIndex).toBe(7);
    expect(reduceTutorial(undone.state, { type: 'progress_operation_recorded', desiredState: 'completed', cellIndex: 8 }).state.nextBeat).toBe(4);
    const result = reduceTutorial(undone.state, { type: 'progress_operation_recorded', desiredState: 'completed', cellIndex: 7 });
    expect(result.state).toMatchObject({ nextBeat: 5, undoneCellIndex: undefined, completedBeats: expect.arrayContaining([UNDO_ACTION_BEAT_ID]) });
  });

  it('does not learn undo from a different completed stitch', () => {
    const state: TutorialState = { runState: 'running', nextBeat: 4, completedBeats: [], lastCompletedCellIndex: 7 };
    expect(reduceTutorial(state, { type: 'progress_operation_recorded', desiredState: 'incomplete', cellIndex: 6 }))
      .toEqual({ state, effects: [] });
  });

  it('skips all mechanics already learned before their beat starts', () => {
    const afterStitch = reduceTutorial(running, { type: 'completed_stitch_recorded', cellIndex: 7, targeted: false });
    const afterMismatch = reduceTutorial(afterStitch.state, { type: 'mismatched_tap_observed', targeted: false });
    const afterUndo = reduceTutorial(afterMismatch.state, { type: 'progress_operation_recorded', desiredState: 'incomplete', cellIndex: 7 });
    const learned = reduceTutorial(afterUndo.state, { type: 'progress_operation_recorded', desiredState: 'completed', cellIndex: 7 });
    const afterPalette = reduceTutorial(learned.state, { type: 'active_thread_color_changed', dmcCode: '321' });
    expect(afterPalette.state.nextBeat).toBe(5);
    expect(afterPalette.state.completedBeats).toEqual(expect.arrayContaining([
      STITCH_ACTION_BEAT_ID, MISMATCHED_TAP_BEAT_ID, UNDO_ACTION_BEAT_ID,
    ]));
  });
});
