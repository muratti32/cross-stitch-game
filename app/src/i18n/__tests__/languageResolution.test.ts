jest.mock('../i18n', () => ({
  __esModule: true,
  default: { changeLanguage: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../deviceLanguages', () => ({
  getDeviceLanguages: jest.fn(),
}));
jest.mock('../languageOverride', () => ({
  getLanguageOverride: jest.fn(),
  setLanguageOverride: jest.fn().mockResolvedValue(undefined),
  clearLanguageOverride: jest.fn().mockResolvedValue(undefined),
}));

import i18n from '../i18n';
import { getDeviceLanguages } from '../deviceLanguages';
import {
  clearLanguageOverride,
  getLanguageOverride,
  setLanguageOverride,
} from '../languageOverride';
import {
  applyResolvedLanguage,
  clearActiveLanguageOverride,
  setActiveLanguageOverride,
} from '../languageResolution';

const changeLanguage = jest.mocked(i18n.changeLanguage);
const mockGetDeviceLanguages = jest.mocked(getDeviceLanguages);
const mockGetLanguageOverride = jest.mocked(getLanguageOverride);
const mockSetLanguageOverride = jest.mocked(setLanguageOverride);
const mockClearLanguageOverride = jest.mocked(clearLanguageOverride);

describe('active App Display Language resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies Turkish for a Turkish device through the runtime resolution path', async () => {
    mockGetLanguageOverride.mockResolvedValue(null);
    mockGetDeviceLanguages.mockReturnValue(['tr-TR']);

    await applyResolvedLanguage();

    expect(changeLanguage).toHaveBeenCalledWith('tr');
  });

  it('applies English for an unsupported device language', async () => {
    mockGetLanguageOverride.mockResolvedValue(null);
    mockGetDeviceLanguages.mockReturnValue(['th-TH']);

    await applyResolvedLanguage();

    expect(changeLanguage).toHaveBeenCalledWith('en');
  });

  it('follows the device language again after clearing the override', async () => {
    mockGetDeviceLanguages.mockReturnValue(['tr-TR']);
    mockGetLanguageOverride.mockResolvedValueOnce('en').mockResolvedValueOnce(null);

    await setActiveLanguageOverride('en');
    await clearActiveLanguageOverride();

    expect(mockSetLanguageOverride).toHaveBeenCalledWith('en');
    expect(mockClearLanguageOverride).toHaveBeenCalledTimes(1);
    expect(changeLanguage).toHaveBeenNthCalledWith(1, 'en');
    expect(changeLanguage).toHaveBeenNthCalledWith(2, 'tr');
  });
});
