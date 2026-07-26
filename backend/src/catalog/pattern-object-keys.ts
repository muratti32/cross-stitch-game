// Single place that enumerates a Pattern's object storage keys. Adding a new
// per-Pattern object (e.g. Pattern Thumbnails, ADR-0042) means editing only
// this file — every call site derives its keys from here instead of building
// them inline.

export interface PatternObjectKeySet {
  readonly artifact: string;
  readonly preview: string;
  readonly thumbnailBrowsing: string;
  readonly thumbnailDetail: string;
  /** Every object that belongs to this Pattern, in a stable order. */
  readonly all: readonly string[];
}

function keySet(prefix: string, artifactFileName: string): PatternObjectKeySet {
  const artifact = `${prefix}/${artifactFileName}`;
  const preview = `${prefix}/preview.png`;
  const thumbnailBrowsing = `${prefix}/thumbnail-browsing.png`;
  const thumbnailDetail = `${prefix}/thumbnail-detail.png`;
  return {
    all: [artifact, preview, thumbnailBrowsing, thumbnailDetail],
    artifact,
    preview,
    thumbnailBrowsing,
    thumbnailDetail,
  };
}

export function personalPatternObjectKeys(patternId: string): PatternObjectKeySet {
  return keySet(`personal-patterns/${patternId}`, 'artifact-v1.bin');
}

// NOTE the deliberate asymmetry: the catalog namespace uses `artifact.bin`,
// every other namespace uses `artifact-v1.bin`.
export function catalogPatternObjectKeys(patternId: string): PatternObjectKeySet {
  return keySet(`patterns/${patternId}`, 'artifact.bin');
}

export function officialPatternDraftObjectKeys(draftId: string): PatternObjectKeySet {
  return keySet(`official-pattern-drafts/${draftId}`, 'artifact-v1.bin');
}

export function catalogSubmissionObjectKeys(submissionId: string): PatternObjectKeySet {
  return keySet(`catalog-submissions/${submissionId}`, 'artifact-v1.bin');
}

// A stored Pattern's artifact and preview keys live in DB columns, which stay
// the source of truth for them; only keys with no column of their own get
// derived from the Pattern id. The two Pattern Thumbnail keys have no column:
// they come from the personal namespace for a Personal Pattern and the catalog
// namespace for a catalog one. A null renderer version means no Thumbnail was
// ever stored, so its keys must not be enumerated.
interface StoredPatternObjects {
  readonly artifactObjectKey: string | null;
  readonly id: string;
  readonly previewObjectKey: string | null;
  readonly thumbnailRendererVersion: number | null;
  readonly visibility: 'catalog' | 'personal';
}

function dedupedKeys(keys: readonly (string | null)[]): readonly string[] {
  return [...new Set(keys.filter((key): key is string => key !== null && key !== ''))];
}

function storedThumbnailKeys(pattern: StoredPatternObjects): readonly string[] {
  if (pattern.thumbnailRendererVersion === null) {
    return [];
  }
  const keys =
    pattern.visibility === 'personal'
      ? personalPatternObjectKeys(pattern.id)
      : catalogPatternObjectKeys(pattern.id);
  return [keys.thumbnailBrowsing, keys.thumbnailDetail];
}

/** Every stored object of a Pattern — used by deletion / Account Deletion Finalization. */
export function storedPatternObjectKeys(pattern: StoredPatternObjects): readonly string[] {
  return dedupedKeys([
    pattern.artifactObjectKey,
    pattern.previewObjectKey,
    ...storedThumbnailKeys(pattern),
  ]);
}

/** Only the publicly distributed objects — used by Safety Removal, which deliberately
 *  retains the private origin artifact for appeal review: the preview and, once a
 *  Pattern Thumbnail has been rendered, both Thumbnail variants. */
export function storedPatternPublicObjectKeys(pattern: StoredPatternObjects): readonly string[] {
  return dedupedKeys([pattern.previewObjectKey, ...storedThumbnailKeys(pattern)]);
}
