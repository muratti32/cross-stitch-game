const BACKEND_CATALOG_PREVIEW_PREFIX = '/v1/catalog-previews/';

/**
 * The admin API returns `previewUrl` as a path on the backend's own origin
 * (LocalObjectStorage.publicUrl -> `/v1/catalog-previews/<key>`), which the
 * browser cannot resolve directly since it never talks to ADMIN_API_URL.
 * Rewrite it to our own public passthrough route instead.
 */
export function toConsolePreviewSrc(previewUrl: string): string {
  if (previewUrl.startsWith(BACKEND_CATALOG_PREVIEW_PREFIX)) {
    return `/api/catalog-previews/${previewUrl.slice(BACKEND_CATALOG_PREVIEW_PREFIX.length)}`;
  }
  return previewUrl;
}
