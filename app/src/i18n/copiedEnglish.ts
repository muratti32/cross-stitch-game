import type { LocaleResources } from './localeParity';
import { collectLocaleLeaves } from './localeResourceTree';

export interface CopiedEnglishViolation { namespace: string; keyPath: string; value: string; }
export type CopiedEnglishAllowlist = Readonly<Record<string, string>>;

export function findCopiedEnglish(reference: LocaleResources, candidate: LocaleResources, allowlist: CopiedEnglishAllowlist = {}): CopiedEnglishViolation[] {
  const target = new Map(collectLocaleLeaves(candidate).map((leaf) => [`${leaf.namespace}:${leaf.keyPath}`, leaf]));
  return collectLocaleLeaves(reference).flatMap((leaf) => {
    const key = `${leaf.namespace}:${leaf.keyPath}`; const other = target.get(key);
    return typeof leaf.value === 'string' && other?.value === leaf.value && allowlist[key] === undefined
      ? [{ namespace: leaf.namespace, keyPath: leaf.keyPath, value: leaf.value }] : [];
  });
}
