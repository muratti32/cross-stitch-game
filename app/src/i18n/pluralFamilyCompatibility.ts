import type { LocaleResources } from './localeParity';
import { collectLocaleLeaves } from './localeResourceTree';

export type PluralForm = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export interface PluralViolation { namespace: string; baseKeyPath: string; missingForms: PluralForm[]; }
const forms = new Set<PluralForm>(['zero', 'one', 'two', 'few', 'many', 'other']);

function families(resources: LocaleResources): Map<string, Set<PluralForm>> {
  const result = new Map<string, Set<PluralForm>>();
  for (const leaf of collectLocaleLeaves(resources)) {
    const match = leaf.keyPath.match(/^(.*)_(zero|one|two|few|many|other)$/) as RegExpMatchArray | null;
    if (match && forms.has(match[2] as PluralForm)) {
      const key = `${leaf.namespace}:${match[1]}`;
      if (!result.has(key)) result.set(key, new Set());
      result.get(key)!.add(match[2] as PluralForm);
    }
  }
  return result;
}

export function comparePluralFamilyCompatibility(reference: LocaleResources, candidate: LocaleResources): PluralViolation[] {
  const target = families(candidate); const violations: PluralViolation[] = [];
  for (const [key, required] of families(reference)) {
    const [namespace, baseKeyPath] = key.split(':');
    const missing = [...required].filter((form) => !target.get(key)?.has(form)).sort() as PluralForm[];
    if (missing.length) violations.push({ namespace, baseKeyPath, missingForms: missing });
  }
  return violations;
}
