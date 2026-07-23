import {
  generateSupportReferenceCode,
  normalizeSupportReferenceCode,
} from './support-reference-code';

describe('Support Reference codes', () => {
  it('generates short opaque codes in the canonical copyable form', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateSupportReferenceCode()));

    expect(codes.size).toBe(100);
    for (const code of codes) {
      expect(code).toMatch(/^SW-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/);
    }
  });

  it('normalizes harmless spacing, casing, and omitted separators', () => {
    expect(normalizeSupportReferenceCode(' sw-abcd-efgh-jkmn ')).toBe('SW-ABCD-EFGH-JKMN');
    expect(normalizeSupportReferenceCode('SWABCDEFGHJKMN')).toBe('SW-ABCD-EFGH-JKMN');
  });

  it('rejects ambiguous and malformed input', () => {
    expect(normalizeSupportReferenceCode('SW-ABCI-EFGH-JKMN')).toBeNull();
    expect(normalizeSupportReferenceCode('SW-ABCD-EFGH')).toBeNull();
  });
});
