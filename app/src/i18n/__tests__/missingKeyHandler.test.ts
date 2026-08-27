jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
}));

import * as Sentry from '@sentry/react-native';
import { resolveMissingTranslation, reportMissingTranslationKey } from '../missingKeyHandler';

describe('resolveMissingTranslation', () => {
  it('falls back to the English string when one is available', () => {
    expect(resolveMissingTranslation('settings.title', 'Settings')).toBe('Settings');
  });

  it('never renders the raw key when no English fallback exists either', () => {
    const result = resolveMissingTranslation('settings.title', undefined);
    expect(result).not.toBe('settings.title');
    expect(result).toBe('');
  });
});

describe('reportMissingTranslationKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports the missing key to Sentry as a low-volume breadcrumb, not an error event', () => {
    reportMissingTranslationKey('settings', 'title', 'tr');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'i18n',
        level: 'info',
        message: expect.stringContaining('settings:title'),
        data: expect.objectContaining({ namespace: 'settings', key: 'title', language: 'tr' }),
      }),
    );
  });
});
