import { randomBytes } from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CANONICAL_PATTERN = /^SW-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/;

export function generateSupportReferenceCode(): string {
  const bytes = randomBytes(12);
  const opaque = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `SW-${opaque.slice(0, 4)}-${opaque.slice(4, 8)}-${opaque.slice(8, 12)}`;
}

export function normalizeSupportReferenceCode(value: string): string | null {
  const compact = value.trim().toUpperCase().replace(/[\s-]+/g, '');
  if (!/^SW[23456789A-HJ-NP-Z]{12}$/.test(compact)) {
    return null;
  }
  const canonical = `SW-${compact.slice(2, 6)}-${compact.slice(6, 10)}-${compact.slice(10, 14)}`;
  return CANONICAL_PATTERN.test(canonical) ? canonical : null;
}
