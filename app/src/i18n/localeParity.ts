/**
 * Pure comparison of two locales' bundled translation resources for key
 * parity (#158). An incomplete or rotten translation must not reach
 * production: a key present in the reference locale and absent from the
 * target locale fails, and a key present only in the target locale (a dead
 * key left behind after it was removed from the reference locale) fails
 * too. Comparison walks every namespace's nested JSON down to its leaf
 * key paths, not just top-level keys.
 *
 * This module has no I/O. scripts/i18n-locale-gate.ts is the thin
 * script-plus-pure-core wrapper that discovers namespaces and locale files
 * on disk and calls this, mirroring scripts/perf-gate.ts's shape.
 */

/** One namespace's translation resource tree, as loaded from its JSON file. */
export type NamespaceResources = Record<string, unknown>;

/** Every namespace's resource tree for one locale, keyed by namespace name. */
export type LocaleResources = Record<string, NamespaceResources>;

/** One offending key: which namespace it lives in and its full leaf key path. */
export interface LocaleParityViolation {
  namespace: string;
  keyPath: string;
}

export interface LocaleParityResult {
  /** Present in the reference locale, missing from the target locale. */
  missingFromTarget: LocaleParityViolation[];
  /** Present in the target locale, missing from the reference locale. */
  missingFromReference: LocaleParityViolation[];
}

/**
 * Recursively collects dotted leaf key paths from a namespace's resource
 * tree. A plain object recurses into its entries; anything else (a string
 * value) is a leaf and its accumulated path is recorded. An empty object
 * contributes no leaf of its own - it has no translated value at that
 * path - so any leaf the other locale has underneath it still surfaces as
 * a divergence instead of being masked by a phantom container key.
 */
function collectLeafKeyPaths(value: unknown, pathPrefix: string, out: Set<string>): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectLeafKeyPaths(child, pathPrefix ? `${pathPrefix}.${key}` : key, out);
    }
    return;
  }
  out.add(pathPrefix);
}

function leafKeyPaths(resources: NamespaceResources): Set<string> {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(resources)) {
    collectLeafKeyPaths(value, key, out);
  }
  return out;
}

/**
 * Compares every namespace present in either locale's resources and
 * returns the leaf key paths that diverge, in both directions. Identical
 * key sets across every namespace produce empty violation lists.
 */
export function compareLocaleKeys(
  reference: LocaleResources,
  target: LocaleResources,
): LocaleParityResult {
  const missingFromTarget: LocaleParityViolation[] = [];
  const missingFromReference: LocaleParityViolation[] = [];

  const namespaces = new Set<string>([...Object.keys(reference), ...Object.keys(target)]);

  for (const namespace of [...namespaces].sort()) {
    const referenceKeys = leafKeyPaths(reference[namespace] ?? {});
    const targetKeys = leafKeyPaths(target[namespace] ?? {});

    for (const keyPath of [...referenceKeys].sort()) {
      if (!targetKeys.has(keyPath)) {
        missingFromTarget.push({ namespace, keyPath });
      }
    }
    for (const keyPath of [...targetKeys].sort()) {
      if (!referenceKeys.has(keyPath)) {
        missingFromReference.push({ namespace, keyPath });
      }
    }
  }

  return { missingFromTarget, missingFromReference };
}
