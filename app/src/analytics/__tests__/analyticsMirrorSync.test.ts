import { setUserProperty } from '@react-native-firebase/analytics';

import { applyAnalyticsMirrorConsent, __resetAnalyticsMirrorGlobals } from '../analyticsMirror';
import { syncAnalyticsMirrorIdentity } from '../analyticsMirrorSync';
import { i18n } from '../../i18n';

const mockedSetUserProperty = setUserProperty as unknown as jest.Mock;

/**
 * The App Display Language is a user property, not an event parameter, so it
 * only ever changes when something re-applies it. Settings can change the
 * language at any time, long after identity settled.
 */
describe('Analytics Mirror user context', () => {
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;
  const originalLanguage = i18n.language;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetAnalyticsMirrorGlobals();
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  });

  afterEach(async () => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
    await i18n.changeLanguage(originalLanguage);
  });

  it('re-applies app_language when the player changes the App Display Language', async () => {
    syncAnalyticsMirrorIdentity();
    applyAnalyticsMirrorConsent(true);
    mockedSetUserProperty.mockClear();

    await i18n.changeLanguage('tr');

    const languageCalls = mockedSetUserProperty.mock.calls
      .filter(([, name]) => name === 'app_language')
      .map(([, , value]) => value);
    expect(languageCalls).toContain('tr');
  });
});
