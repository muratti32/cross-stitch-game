jest.mock('../../local-db', () => ({
  getDeviceConfigValue: jest.fn(),
  setDeviceConfigValue: jest.fn(),
  deleteDeviceConfigValue: jest.fn(),
}));

import * as localDb from '../../local-db';
import { getLanguageOverride, setLanguageOverride, clearLanguageOverride } from '../languageOverride';

describe('language override persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads the stored override key from device-local storage', async () => {
    jest.mocked(localDb.getDeviceConfigValue).mockResolvedValue('tr');
    await expect(getLanguageOverride()).resolves.toBe('tr');
    expect(localDb.getDeviceConfigValue).toHaveBeenCalledWith('app_language_override');
  });

  it('returns null when no override has been stored', async () => {
    jest.mocked(localDb.getDeviceConfigValue).mockResolvedValue(null);
    await expect(getLanguageOverride()).resolves.toBeNull();
  });

  it('writes the override to device-local storage, never account data', async () => {
    await setLanguageOverride('tr');
    expect(localDb.setDeviceConfigValue).toHaveBeenCalledWith('app_language_override', 'tr');
  });

  it('clears a stored override so resolution falls back to the device language', async () => {
    await clearLanguageOverride();
    expect(localDb.deleteDeviceConfigValue).toHaveBeenCalledWith('app_language_override');
  });
});
