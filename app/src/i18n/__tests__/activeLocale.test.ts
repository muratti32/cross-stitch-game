import i18n from '../i18n';
import { getActiveLocale } from '../activeLocale';
import { FALLBACK_LOCALE } from '../resolveAppLanguage';

describe('getActiveLocale', () => {
  afterEach(async () => {
    await i18n.changeLanguage(FALLBACK_LOCALE);
  });

  it('returns the English fallback by default', () => {
    expect(getActiveLocale()).toBe('en');
  });

  it('reflects the active i18next language after it changes', async () => {
    await i18n.changeLanguage('tr');
    expect(getActiveLocale()).toBe('tr');
  });
});
