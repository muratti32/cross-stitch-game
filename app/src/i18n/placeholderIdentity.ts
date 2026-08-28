import type { LocaleResources } from './localeParity';
import { collectLocaleLeaves } from './localeResourceTree';

export interface PlaceholderViolation { namespace: string; keyPath: string; reference: string[]; candidate: string[]; }

function placeholders(value: unknown): Set<string> {
  return typeof value === 'string' ? new Set([...value.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1])) : new Set();
}

export function comparePlaceholderIdentity(reference: LocaleResources, candidate: LocaleResources): PlaceholderViolation[] {
  const candidateLeaves = new Map(collectLocaleLeaves(candidate).map((leaf) => [`${leaf.namespace}:${leaf.keyPath}`, leaf]));
  return collectLocaleLeaves(reference).flatMap((leaf) => {
    const other = candidateLeaves.get(`${leaf.namespace}:${leaf.keyPath}`);
    if (!other || typeof leaf.value !== 'string' || typeof other.value !== 'string') return [];
    const a = [...placeholders(leaf.value)].sort(); const b = [...placeholders(other.value)].sort();
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ namespace: leaf.namespace, keyPath: leaf.keyPath, reference: a, candidate: b }];
  });
}
