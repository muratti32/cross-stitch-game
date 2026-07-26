export type PatternSurfaceVariant = 'browsing' | 'detail';

export interface PatternThumbnailUrls {
  browsing: string;
  detail: string;
}

/** The image assets a Pattern may carry, as a surface knows them. */
export interface PatternImageAssets {
  thumbnailUrls?: PatternThumbnailUrls | null;
  previewUrl?: string | null;
}

export type PatternImageSelection =
  | { kind: 'thumbnail'; variant: PatternSurfaceVariant; url: string }
  | { kind: 'preview'; url: string }
  | { kind: 'none' };

/**
 * Pure. Given a Pattern's available image assets and the surface's variant,
 * returns what that surface displays.
 */
export function selectPatternImage(
  assets: PatternImageAssets,
  variant: PatternSurfaceVariant,
): PatternImageSelection {
  const thumbnailUrl = nonEmptyUrl(assets.thumbnailUrls?.[variant]);
  if (thumbnailUrl !== null) {
    return { kind: 'thumbnail', variant, url: thumbnailUrl };
  }

  const previewUrl = nonEmptyUrl(assets.previewUrl);
  if (previewUrl !== null) {
    return { kind: 'preview', url: previewUrl };
  }

  return { kind: 'none' };
}

function nonEmptyUrl(url: string | null | undefined): string | null {
  const trimmedUrl = url?.trim();
  return trimmedUrl === undefined || trimmedUrl.length === 0 ? null : trimmedUrl;
}
