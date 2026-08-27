import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiFetch } from './apiFetch';
import { Config } from '../config';
import { getCatalogCache, setCatalogCache } from '../local-db';
import { getSurfaceKey, getCacheKey, localeCacheLookupOrder } from '../catalog-cache-logic';
import { getActiveLocale } from '../i18n/activeLocale';
import { SUPPORTED_LOCALES } from '../i18n/supportedLocales';
import { isServerApiError, localizeServerError } from './localizeServerError';
import type { PatternThumbnailUrls } from '../pattern-assets';

export type UnlockPriceTier = 'small' | 'medium' | 'large' | null;

export interface CatalogTagRef {
  code: string;
  label: string;
}

export interface CatalogPatternItem {
  id: string;
  title: string;
  creatorName: string;
  categoryCode: string;
  tags: CatalogTagRef[];
  width: number;
  height: number;
  paletteSize: number;
  previewUrl: string;
  thumbnailUrls?: PatternThumbnailUrls | null;
  originalImageUrl?: string;
  unlockPriceTier: UnlockPriceTier;
  publishedAt: string;
  description?: string | null;
  sourceLanguage?: string | null;
  creatorProfileId?: string | null;
  creatorUsername?: string | null;
  likeCount: number;
  viewerLiked: boolean;
}

export interface CatalogPage {
  items: CatalogPatternItem[];
  nextCursor: string | null;
}

export interface CatalogCategory {
  code: string;
  label: string;
  count: number;
}

export interface CachedResult<T> {
  data: T;
  fromCache: boolean;
  fetchedAt: string | null;
}

export function absolutePreviewUrl(previewUrl: string): string {
  return previewUrl.startsWith('http')
    ? previewUrl
    : `${Config.apiBaseUrl}${previewUrl}`;
}

export function absoluteThumbnailUrls(
  thumbnailUrls: PatternThumbnailUrls | null | undefined,
): PatternThumbnailUrls | null {
  if (thumbnailUrls === null || thumbnailUrls === undefined) {
    return null;
  }
  return {
    browsing: absolutePreviewUrl(thumbnailUrls.browsing),
    detail: absolutePreviewUrl(thumbnailUrls.detail),
  };
}

// Typed, ServerApiErrorLike (status + reason) the same way
// AccountDeletionApiError and the other per-module API error classes are,
// so a genuine backend failure on a catalog request can be resolved to a
// localized, reason-coded message via localizeServerError (#159) instead of
// the raw English `message` the backend returns.
export class CatalogApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = 'CatalogApiError';
  }
}

async function parseCatalogError(response: Response): Promise<CatalogApiError> {
  let message = `Catalog request failed with status ${response.status}`;
  let reason: string | null = null;
  try {
    const body = (await response.json()) as { message?: unknown; reason?: unknown };
    if (typeof body.message === 'string') message = body.message;
    if (typeof body.reason === 'string') reason = body.reason;
  } catch {
    // ignore - response had no JSON body
  }
  return new CatalogApiError(response.status, message, reason);
}

async function fetchCatalogJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) {
    throw await parseCatalogError(response);
  }
  return (await response.json()) as T;
}

export interface CatalogErrorPresentation {
  title: string;
  body: string;
}

/**
 * Resolves a catalog screen's error state to the title and body the player
 * sees. A genuine backend failure (CatalogApiError, ServerApiErrorLike)
 * always gets `genericTitle` plus its #159 reason-coded or
 * generic-plus-Support-Reference message, never a connectivity-specific
 * title - pairing e.g. "Search Needs a Connection" with a server-side
 * failure message would misleadingly suggest the fix is reconnecting.
 * Anything else (typically an OfflineError with nothing cached yet) falls
 * back to the screen's own catalog-specific copy.
 */
export function presentCatalogError(
  error: unknown,
  fallback: CatalogErrorPresentation & { genericTitle: string },
): CatalogErrorPresentation {
  if (isServerApiError(error)) {
    return { title: fallback.genericTitle, body: localizeServerError(error) };
  }
  return { title: fallback.title, body: fallback.body };
}

// Offline Catalog Cache: on success the payload overwrites the cached surface
// under the active locale's own key; on failure the last successful payload
// for that surface is served read-only and flagged so the UI can show the
// "potentially stale" banner (ADR-0024).
//
// The cache key incorporates the App Display Language (#160) so a language
// change can never surface the previous locale's Catalog Tag/Category
// labels as the current ones: entries under a locale the player has since
// moved away from are simply never looked up by that key again. They are
// not purged - they expire on their existing TTL (isCacheStale) - and on a
// failure with no entry yet under the active locale, the lookup falls back
// to whatever other locale is cached (localeCacheLookupOrder) so a player
// who changes language while offline is never blocked from browsing;
// per CONTEXT.md's Connectivity State, they may briefly see labels in the
// previous language instead.
async function fetchWithCatalogCache<T>(surfaceKey: string): Promise<CachedResult<T>> {
  const activeLocale = getActiveLocale();
  const cacheKey = getCacheKey(surfaceKey, activeLocale);
  try {
    const data = await fetchCatalogJson<T>(surfaceKey);
    await setCatalogCache(cacheKey, JSON.stringify(data));
    return { data, fromCache: false, fetchedAt: null };
  } catch (err) {
    for (const locale of localeCacheLookupOrder(activeLocale, SUPPORTED_LOCALES)) {
      const cached = await getCatalogCache(getCacheKey(surfaceKey, locale));
      if (cached) {
        return {
          data: JSON.parse(cached.payloadJson) as T,
          fromCache: true,
          fetchedAt: cached.fetchedAt,
        };
      }
    }
    throw err;
  }
}

// Every catalog queryKey below includes the active locale. The locale
// itself is never added to a request or a surface key by these call sites
// (see apiFetch/performAuthenticatedRequest for the request's `locale`
// param, and fetchWithCatalogCache above for the persisted cache key) - it
// is included here only so that changing the App Display Language produces
// a distinct React Query key and therefore a fresh fetch, instead of
// continuing to serve an in-memory result fetched under the previous
// locale.
export function useStaffPicks() {
  const locale = getActiveLocale();
  return useQuery<CachedResult<CatalogPatternItem[]>>({
    queryKey: ['catalog', 'staff-picks', locale],
    queryFn: () =>
      fetchWithCatalogCache<CatalogPatternItem[]>(
        getSurfaceKey('/v1/catalog/staff-picks', {}),
      ),
  });
}

export function useCatalogCategories() {
  const locale = getActiveLocale();
  return useQuery<CachedResult<CatalogCategory[]>>({
    queryKey: ['catalog', 'categories', locale],
    queryFn: () =>
      fetchWithCatalogCache<CatalogCategory[]>(
        getSurfaceKey('/v1/catalog/categories', {}),
      ),
  });
}

export function useCatalogTags() {
  const locale = getActiveLocale();
  return useQuery<CachedResult<CatalogTagRef[]>>({
    queryKey: ['catalog', 'tags', locale],
    queryFn: () =>
      fetchWithCatalogCache<CatalogTagRef[]>(getSurfaceKey('/v1/catalog/tags', {})),
  });
}

const NEW_PAGE_LIMIT = 10;

// Only the first page participates in the offline cache; deeper pagination is
// an online-only affordance per the read-only offline browsing rule.
export function useNewPatterns() {
  const locale = getActiveLocale();
  return useInfiniteQuery<CachedResult<CatalogPage>>({
    queryKey: ['catalog', 'new', locale],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam as string | null;
      const surfaceKey = getSurfaceKey('/v1/catalog/new', {
        cursor: cursor ?? undefined,
        limit: NEW_PAGE_LIMIT,
      });
      if (cursor === null) {
        return fetchWithCatalogCache<CatalogPage>(surfaceKey);
      }
      return fetchCatalogJson<CatalogPage>(surfaceKey).then((data) => ({
        data,
        fromCache: false,
        fetchedAt: null,
      }));
    },
    getNextPageParam: (lastPage) =>
      lastPage.fromCache ? undefined : (lastPage.data.nextCursor ?? undefined),
  });
}

export function usePatternsBrowse(options: { category?: string; tag?: string }) {
  const locale = getActiveLocale();
  return useInfiniteQuery<CachedResult<CatalogPage>>({
    queryKey: [
      'catalog',
      'browse',
      options.category ?? null,
      options.tag ?? null,
      locale,
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const cursor = pageParam as string | null;
      const surfaceKey = getSurfaceKey('/v1/catalog/patterns', {
        category: options.category,
        tag: options.tag,
        cursor: cursor ?? undefined,
        limit: NEW_PAGE_LIMIT,
      });
      if (cursor === null) {
        return fetchWithCatalogCache<CatalogPage>(surfaceKey);
      }
      return fetchCatalogJson<CatalogPage>(surfaceKey).then((data) => ({
        data,
        fromCache: false,
        fetchedAt: null,
      }));
    },
    getNextPageParam: (lastPage) =>
      lastPage.fromCache ? undefined : (lastPage.data.nextCursor ?? undefined),
  });
}

export function useCatalogPattern(id: string | undefined, enabled: boolean) {
  const locale = getActiveLocale();
  return useQuery<CachedResult<CatalogPatternItem>>({
    queryKey: ['catalog', 'pattern', id, locale],
    enabled: enabled && !!id,
    queryFn: () =>
      fetchWithCatalogCache<CatalogPatternItem>(`/v1/catalog/patterns/${id}`),
  });
}

// Search is an online-only surface: no cache write, no offline fallback.
export function useCatalogSearch(q: string) {
  const locale = getActiveLocale();
  const trimmed = q.trim();
  return useQuery<CatalogPatternItem[]>({
    queryKey: ['catalog', 'search', trimmed, locale],
    enabled: trimmed.length >= 2,
    queryFn: () =>
      fetchCatalogJson<CatalogPatternItem[]>(
        getSurfaceKey('/v1/catalog/search', { q: trimmed, limit: 25 }),
      ),
  });
}
