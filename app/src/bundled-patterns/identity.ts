import manifestJson from '../../assets/bundled-patterns/manifest.json';

/** A Bundled Starter Pattern's catalog UUID and the `assetKey` that named it locally before #290. */
export const LEGACY_BUNDLED_PATTERN_IDS: readonly { legacyId: string; id: string }[] = manifestJson.map(
  ({ assetKey, id }) => ({ legacyId: assetKey, id }),
);

const bundledPatternIds = new Set(manifestJson.map(({ id }) => id));

export function isBundledPatternId(id: string): boolean {
  return bundledPatternIds.has(id);
}

/** The catalog UUID of a legacy id; any other id comes back unchanged. */
export function bundledPatternIdFromLegacy(id: string): string {
  return LEGACY_BUNDLED_PATTERN_IDS.find(({ legacyId }) => legacyId === id)?.id ?? id;
}
