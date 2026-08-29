import type { LocaleResources } from './localeParity';
import { collectLocaleLeaves } from './localeResourceTree';

export interface CopiedEnglishViolation { namespace: string; keyPath: string; value: string; }
export type CopiedEnglishAllowlist = Readonly<Record<string, string>>;

export function findCopiedEnglish(reference: LocaleResources, candidate: LocaleResources, allowlist: CopiedEnglishAllowlist = {}, locale?: string): CopiedEnglishViolation[] {
  const target = new Map(collectLocaleLeaves(candidate).map((leaf) => [`${leaf.namespace}:${leaf.keyPath}`, leaf]));
  return collectLocaleLeaves(reference).flatMap((leaf) => {
    const key = `${leaf.namespace}:${leaf.keyPath}`; const other = target.get(key);
    const localeKey = locale === undefined ? undefined : `${locale}:${key}`;
    const allowlisted = allowlist[key] !== undefined || (localeKey !== undefined && allowlist[localeKey] !== undefined);
    return typeof leaf.value === 'string' && other?.value === leaf.value && !allowlisted
      ? [{ namespace: leaf.namespace, keyPath: leaf.keyPath, value: leaf.value }] : [];
  });
}
