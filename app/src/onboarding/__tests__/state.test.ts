jest.mock('../../local-db', () => ({
  getDeviceConfigValue: jest.fn(),
  setDeviceConfigValue: jest.fn(),
  setDeviceConfigValues: jest.fn(),
  hasPlayHistory: jest.fn(),
}));

import * as localDb from '../../local-db';
import { loadOnboardingState, saveOnboardingPosition, startTutorial } from '../state';

describe('onboarding persistence', () => {
  beforeEach(() => jest.clearAllMocks());

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
    ]);
  });
});
