// Single place that enumerates a Pattern's object storage keys. Adding a new
// per-Pattern object (e.g. Pattern Thumbnails, ADR-0042) means editing only
// this file — every call site derives its keys from here instead of building
// them inline.

export interface PatternObjectKeySet {
  readonly artifact: string;
  readonly preview: string;
  /** Every object that belongs to this Pattern, in a stable order. */
  readonly all: readonly string[];
}

function keySet(artifact: string, preview: string): PatternObjectKeySet {
  return { all: [artifact, preview], artifact, preview };
}

export function personalPatternObjectKeys(patternId: string): PatternObjectKeySet {
  return keySet(
    `personal-patterns/${patternId}/artifact-v1.bin`,
    `personal-patterns/${patternId}/preview.png`,
  );
}

// NOTE the deliberate asymmetry: the catalog namespace uses `artifact.bin`,
// every other namespace uses `artifact-v1.bin`.
export function catalogPatternObjectKeys(patternId: string): PatternObjectKeySet {
  return keySet(
    `patterns/${patternId}/artifact.bin`,
    `patterns/${patternId}/preview.png`,
  );
}

export function officialPatternDraftObjectKeys(draftId: string): PatternObjectKeySet {
  return keySet(
    `official-pattern-drafts/${draftId}/artifact-v1.bin`,
    `official-pattern-drafts/${draftId}/preview.png`,
  );
}

export function catalogSubmissionObjectKeys(submissionId: string): PatternObjectKeySet {
  return keySet(
    `catalog-submissions/${submissionId}/artifact-v1.bin`,
    `catalog-submissions/${submissionId}/preview.png`,
  );
}

// A stored Pattern's artifact and preview keys live in DB columns, which stay
// the source of truth for them; only keys with no column of their own get
// derived from the Pattern id.
interface StoredPatternObjects {
  readonly artifactObjectKey: string | null;
  readonly previewObjectKey: string | null;
}

function dedupedKeys(keys: readonly (string | null)[]): readonly string[] {
  return [...new Set(keys.filter((key): key is string => key !== null && key !== ''))];
}

/** Every stored object of a Pattern — used by deletion / Account Deletion Finalization. */
export function storedPatternObjectKeys(pattern: StoredPatternObjects): readonly string[] {
  return dedupedKeys([pattern.artifactObjectKey, pattern.previewObjectKey]);
}

/** Only the publicly distributed objects — used by Safety Removal, which deliberately
 *  retains the private origin artifact for appeal review. Today: the preview.
 *  When Pattern Thumbnails land they join this set. */
export function storedPatternPublicObjectKeys(pattern: StoredPatternObjects): readonly string[] {
  return dedupedKeys([pattern.previewObjectKey]);
}
