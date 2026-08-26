import {
  initialTutorialEffects,
  reduceTutorial,
  THREAD_PALETTE_BEAT_ID,
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
    expect(result.effects).toEqual([{
      type: 'persist', state: result.state, observedActiveDmcCode: '321',
    }]);
  });

  it('pauses without changing the beat cursor', () => {
    const result = reduceTutorial(running, { type: 'skip_requested' });
    expect(result.state).toEqual({ ...running, runState: 'paused' });
    expect(result.effects).toEqual([{ type: 'persist', state: result.state }]);
  });

  it('keeps the advanced cursor stable through a later scripted event', () => {
    const selected = reduceTutorial(running, {
      type: 'active_thread_color_changed', dmcCode: '321',
    });
    const laterSkip = reduceTutorial(selected.state, { type: 'skip_requested' });

    expect(laterSkip).toEqual({ state: selected.state, effects: [] });
  });

  it('does nothing after pause or beat completion', () => {
    const paused = { ...running, runState: 'paused' as const };
    expect(reduceTutorial(paused, { type: 'active_thread_color_changed', dmcCode: '321' }))
      .toEqual({ state: paused, effects: [] });
  });
});
