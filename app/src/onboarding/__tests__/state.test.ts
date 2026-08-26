jest.mock('../../local-db', () => ({
  getDeviceConfigValue: jest.fn(),
  setDeviceConfigValue: jest.fn(),
  hasPlayHistory: jest.fn(),
}));

import * as localDb from '../../local-db';
import { loadOnboardingState, saveOnboardingPosition } from '../state';

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
});
