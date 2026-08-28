import type { LocaleResources } from './localeParity';

export interface LocaleLeaf {
  namespace: string;
  keyPath: string;
  value: unknown;
}

function collect(value: unknown, prefix: string, out: LocaleLeaf[], namespace: string): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collect(child, prefix ? `${prefix}.${key}` : key, out, namespace);
    }
    return;
  }
  out.push({ namespace, keyPath: prefix, value });
}

export function collectLocaleLeaves(resources: LocaleResources): LocaleLeaf[] {
  const leaves: LocaleLeaf[] = [];
  for (const [namespace, values] of Object.entries(resources)) collect(values, '', leaves, namespace);
  return leaves.sort((a, b) => `${a.namespace}:${a.keyPath}`.localeCompare(`${b.namespace}:${b.keyPath}`));
}
