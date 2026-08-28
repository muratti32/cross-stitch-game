import { resolveAppLanguage } from '../resolveAppLanguage';

const SUPPORTED = ['en', 'tr'] as const;

describe('resolveAppLanguage', () => {
  it('resolves a supported device language to itself', () => {
    expect(resolveAppLanguage(['tr'], null, SUPPORTED)).toBe('tr');
  });

  it('resolves an unsupported device language to English', () => {
    expect(resolveAppLanguage(['fr'], null, SUPPORTED)).toBe('en');
  });

  it('normalizes a region-tagged device language to its base language', () => {
    expect(resolveAppLanguage(['tr-TR'], null, SUPPORTED)).toBe('tr');
  });

  it('resolves an empty device language list to English', () => {
    expect(resolveAppLanguage([], null, SUPPORTED)).toBe('en');
  });

  it('falls through an unsupported leading device language to a supported later one', () => {
    expect(resolveAppLanguage(['fr', 'tr'], null, SUPPORTED)).toBe('tr');
  });

  it('prefers a supported override over the device language', () => {
    expect(resolveAppLanguage(['en'], 'tr', SUPPORTED)).toBe('tr');
  });

  it('normalizes a region-tagged override to its base language', () => {
    expect(resolveAppLanguage(['en'], 'tr-TR', SUPPORTED)).toBe('tr');
  });

  it('falls back to the device language when the override is unsupported', () => {
    expect(resolveAppLanguage(['tr'], 'fr', SUPPORTED)).toBe('tr');
  });

  it('follows the device language again once the override is cleared', () => {
    expect(resolveAppLanguage(['tr'], null, SUPPORTED)).toBe('tr');
  });

  it('resolves to English when both override and device language are unsupported', () => {
    expect(resolveAppLanguage(['fr'], 'de', SUPPORTED)).toBe('en');
  });
});
