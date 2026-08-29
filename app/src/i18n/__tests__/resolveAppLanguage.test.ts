import { resolveAppLanguage } from '../resolveAppLanguage';
import { APP_LOCALE_CATALOG } from '../localeCatalog';
import { SUPPORTED_LOCALES } from '../supportedLocales';

const SUPPORTED = ['en', 'tr'] as const;

describe('resolveAppLanguage', () => {
  it('keeps the staged catalog separate from the released resource set', () => {
    expect(APP_LOCALE_CATALOG.map(({ identifier }) => identifier)).toEqual(['en', 'tr', 'es', 'de', 'fr', 'pt-BR', 'it']);
    expect(SUPPORTED_LOCALES).toEqual(['de', 'en', 'es', 'fr', 'it', 'pt-BR', 'tr']);
  });

  it('resolves a supported device language to itself', () => {
    expect(resolveAppLanguage(['tr'], null, SUPPORTED)).toBe('tr');
  });

  it('resolves an unsupported device language to English', () => {
    expect(resolveAppLanguage(['fr'], null, SUPPORTED)).toBe('en');
  });

  it('uses a supported base language when a region variant is not supported', () => {
    expect(resolveAppLanguage(['tr-TR'], null, SUPPORTED)).toBe('tr');
  });

  it('prefers an exact canonical BCP 47 match over a base-language match', () => {
    expect(resolveAppLanguage(['es-MX'], null, ['es', 'es-MX'])).toBe('es-MX');
    expect(resolveAppLanguage(['ES_mx'], null, ['es', 'es-MX'])).toBe('es-MX');
  });

  it('does not match an unsupported region to another region of the same language', () => {
    expect(resolveAppLanguage(['pt-PT'], null, ['pt-BR'])).toBe('en');
  });

  it('resolves an empty device language list to English', () => {
    expect(resolveAppLanguage([], null, SUPPORTED)).toBe('en');
  });

  it('falls through unsupported device languages in preference order', () => {
    expect(resolveAppLanguage(['fr', 'de-DE', 'tr'], null, SUPPORTED)).toBe('tr');
    expect(resolveAppLanguage(['de-DE', 'fr-FR'], null, ['fr', 'de'])).toBe('de');
  });

  it('prefers a supported override over the device language', () => {
    expect(resolveAppLanguage(['en'], 'tr', SUPPORTED)).toBe('tr');
  });

  it('uses an exact canonical override before trying its base language', () => {
    expect(resolveAppLanguage(['en'], 'es-MX', ['en', 'es', 'es-MX'])).toBe('es-MX');
    expect(resolveAppLanguage(['en'], 'tr-TR', SUPPORTED)).toBe('tr');
  });

  it('does not resolve an unreleased catalog locale', () => {
    expect(resolveAppLanguage(['es-MX'], null, SUPPORTED)).toBe('en');
    expect(resolveAppLanguage(['en'], 'es', SUPPORTED)).toBe('en');
  });

  it('follows the device language again once an override is cleared', () => {
    expect(resolveAppLanguage(['tr'], null, SUPPORTED)).toBe('tr');
  });

  it('falls back to the device language when the override is unsupported', () => {
    expect(resolveAppLanguage(['tr'], 'fr', SUPPORTED)).toBe('tr');
  });

  it('keeps the fixed fallback when no override or device language matches', () => {
    expect(resolveAppLanguage(['fr'], 'de', SUPPORTED)).toBe('en');
  });

  it('canonicalizes a supported override before matching', () => {
    expect(resolveAppLanguage(['en'], 'tr-TR', SUPPORTED)).toBe('tr');
  });
});
