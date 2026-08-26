jest.mock('../../local-db', () => ({
  getDeviceConfigValue: jest.fn(),
  setDeviceConfigValue: jest.fn(),
  setDeviceConfigValues: jest.fn(),
  hasPlayHistory: jest.fn(),
  findActiveSessionForPattern: jest.fn(),
}));

import * as localDb from '../../local-db';
import {
  loadOnboardingState,
  persistTutorialTransition,
  resumeTutorial,
  saveOnboardingPosition,
  startTutorial,
  resetOnboarding,
} from '../state';

describe('onboarding persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(localDb.findActiveSessionForPattern).mockResolvedValue(null);
  });

  it('backfills an existing install to complete', async () => {
    jest.mocked(localDb.getDeviceConfigValue).mockResolvedValue(null);
    jest.mocked(localDb.hasPlayHistory).mockResolvedValue(true);

    await expect(loadOnboardingState()).resolves.toMatchObject({ position: 'complete' });
    expect(localDb.setDeviceConfigValue).toHaveBeenCalledWith('onboarding.v1.status', 'complete');
  });

  it('places a fresh install at welcome durably', async () => {
    jest.mocked(localDb.getDeviceConfigValue).mockResolvedValue(null);
    jest.mocked(localDb.hasPlayHistory).mockResolvedValue(false);

    await expect(loadOnboardingState()).resolves.toMatchObject({ position: 'welcome' });
    expect(localDb.setDeviceConfigValue).toHaveBeenCalledWith('onboarding.v1.status', 'welcome');
  });

  it('persists valid positions', async () => {
    await saveOnboardingPosition('deferred');
    expect(localDb.setDeviceConfigValue).toHaveBeenCalledWith('onboarding.v1.status', 'deferred');
  });

  it('persists the tutorial start as one atomic config transition', async () => {
    await startTutorial('session-heart');
    expect(localDb.setDeviceConfigValues).toHaveBeenCalledWith([
      ['onboarding.v1.status', 'in_tutorial'],
      ['tutorial.v1.status', 'running'],
      ['tutorial.v1.session_id', 'session-heart'],
      ['tutorial.v1.next_beat', '1'],
      ['tutorial.v1.completed_beats', '[]'],
      ['tutorial.v1.undone_cell_index', ''],
      ['tutorial.v1.last_completed_cell_index', ''],
      ['tutorial.v1.thread_color_completion_observed', ''],
    ]);
  });

  it('recovers a starter session created just before a kill', async () => {
    jest.mocked(localDb.getDeviceConfigValue).mockImplementation(async (key) =>
      key === 'onboarding.v1.status' ? 'welcome' : null,
    );
    jest.mocked(localDb.findActiveSessionForPattern).mockResolvedValue({ id: 'session-heart' } as never);

    await expect(loadOnboardingState()).resolves.toMatchObject({
      position: 'in_tutorial',
      tutorialSessionId: 'session-heart',
      activeDmcCode: null,
    });
    expect(localDb.setDeviceConfigValues).toHaveBeenCalled();
  });

  it('atomically persists the observed active color with the advanced cursor', async () => {
    await persistTutorialTransition({
      tutorialRunState: 'running', nextBeat: 2, completedBeats: ['thread_palette'],
    }, '321');
    expect(localDb.setDeviceConfigValues).toHaveBeenCalledWith([
      ['onboarding.v1.status', 'in_tutorial'],
      ['tutorial.v1.status', 'running'],
      ['tutorial.v1.next_beat', '2'],
      ['tutorial.v1.completed_beats', '["thread_palette"]'],
      ['tutorial.v1.undone_cell_index', ''],
      ['tutorial.v1.last_completed_cell_index', ''],
      ['tutorial.v1.thread_color_completion_observed', ''],
      ['tutorial.v1.active_dmc_code', '321'],
    ]);
  });

  it('restores the durable active color with the tutorial cursor', async () => {
    jest.mocked(localDb.getDeviceConfigValue).mockImplementation(async (key) => ({
      'onboarding.v1.status': 'in_tutorial',
      'tutorial.v1.status': 'running',
      'tutorial.v1.session_id': 'session-heart',
      'tutorial.v1.next_beat': '2',
      'tutorial.v1.completed_beats': '["thread_palette"]',
      'tutorial.v1.active_dmc_code': '321',
    }[key] ?? null));

    await expect(loadOnboardingState()).resolves.toMatchObject({
      tutorialSessionId: 'session-heart', nextBeat: 2, activeDmcCode: '321',
    });
    expect(localDb.findActiveSessionForPattern).not.toHaveBeenCalled();
  });

  it('resets onboarding atomically to the fresh-install state', async () => {
    await resetOnboarding();
    expect(localDb.setDeviceConfigValues).toHaveBeenCalledWith([
      ['onboarding.v1.status', 'welcome'],
      ['tutorial.v1.status', 'running'],
      ['tutorial.v1.session_id', ''],
      ['tutorial.v1.next_beat', '1'],
      ['tutorial.v1.completed_beats', '[]'],
      ['tutorial.v1.active_dmc_code', ''],
      ['tutorial.v1.thread_color_completion_observed', ''],
    ]);
  });

  it('resumes a paused tutorial without changing its session or beat cursor', async () => {
    jest.mocked(localDb.getDeviceConfigValue).mockImplementation(async (key) => ({
      'onboarding.v1.status': 'in_tutorial',
      'tutorial.v1.status': 'paused',
      'tutorial.v1.session_id': 'session-heart',
      'tutorial.v1.next_beat': '4',
      'tutorial.v1.completed_beats': '["thread_palette","mismatched_tap"]',
    }[key] ?? null));
    await loadOnboardingState();

    await resumeTutorial('session-heart');

    expect(localDb.setDeviceConfigValues).toHaveBeenLastCalledWith([
      ['onboarding.v1.status', 'in_tutorial'],
      ['tutorial.v1.status', 'running'],
      ['tutorial.v1.next_beat', '4'],
      ['tutorial.v1.completed_beats', '["thread_palette","mismatched_tap"]'],
      ['tutorial.v1.undone_cell_index', ''],
      ['tutorial.v1.last_completed_cell_index', ''],
      ['tutorial.v1.thread_color_completion_observed', ''],
    ]);
  });

  it('does not treat a missing undo cell as cell zero', async () => {
    await expect(loadOnboardingState()).resolves.toMatchObject({ undoneCellIndex: undefined });
  });

  it('marks onboarding complete with a completion timestamp atomically', async () => {
    await persistTutorialTransition({
      tutorialRunState: 'complete', nextBeat: 7, completedBeats: ['thread_color_completion'],
    });

    expect(localDb.setDeviceConfigValues).toHaveBeenCalledWith(expect.arrayContaining([
      ['onboarding.v1.status', 'complete'],
      ['tutorial.v1.status', 'complete'],
      ['onboarding.v1.completed_at', expect.any(String)],
    ]));
  });
});
