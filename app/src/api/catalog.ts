import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiFetch } from './apiFetch';
import { Config } from '../config';
import { getCatalogCache, setCatalogCache } from '../local-db';
import { getSurfaceKey } from '../catalog-cache-logic';

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

async function fetchCatalogJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) {
    throw new Error(`Catalog request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

// Offline Catalog Cache: on success the payload overwrites the cached surface;
// on failure the last successful payload is served read-only and flagged so the
// UI can show the "potentially stale" banner (ADR-0024).
async function fetchWithCatalogCache<T>(surfaceKey: string): Promise<CachedResult<T>> {
  try {
    const data = await fetchCatalogJson<T>(surfaceKey);
    await setCatalogCache(surfaceKey, JSON.stringify(data));
    return { data, fromCache: false, fetchedAt: null };
  } catch (err) {
    const cached = await getCatalogCache(surfaceKey);
    if (cached) {
      return {
        data: JSON.parse(cached.payloadJson) as T,
        fromCache: true,
        fetchedAt: cached.fetchedAt,
      };
    }
    throw err;
  }
}

export function useStaffPicks() {
  return useQuery<CachedResult<CatalogPatternItem[]>>({
    queryKey: ['catalog', 'staff-picks'],
    queryFn: () =>
      fetchWithCatalogCache<CatalogPatternItem[]>(
        getSurfaceKey('/v1/catalog/staff-picks', {}),
      ),
  });
}

export function useCatalogCategories() {
  return useQuery<CachedResult<CatalogCategory[]>>({
    queryKey: ['catalog', 'categories'],
    queryFn: () =>
      fetchWithCatalogCache<CatalogCategory[]>(
        getSurfaceKey('/v1/catalog/categories', {}),
      ),
  });
}

export function useCatalogTags(locale = 'en') {
  return useQuery<CachedResult<CatalogTagRef[]>>({
    queryKey: ['catalog', 'tags', locale],
    queryFn: () =>
      fetchWithCatalogCache<CatalogTagRef[]>(
        getSurfaceKey('/v1/catalog/tags', { locale }),
      ),
  });
}

const NEW_PAGE_LIMIT = 10;

// Only the first page participates in the offline cache; deeper pagination is
// an online-only affordance per the read-only offline browsing rule.
export function useNewPatterns() {
  return useInfiniteQuery<CachedResult<CatalogPage>>({
    queryKey: ['catalog', 'new'],
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
  return useInfiniteQuery<CachedResult<CatalogPage>>({
    queryKey: ['catalog', 'browse', options.category ?? null, options.tag ?? null],
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
  return useQuery<CachedResult<CatalogPatternItem>>({
    queryKey: ['catalog', 'pattern', id],
    enabled: enabled && !!id,
    queryFn: () =>
      fetchWithCatalogCache<CatalogPatternItem>(`/v1/catalog/patterns/${id}`),
  });
}

// Search is an online-only surface: no cache write, no offline fallback.
export function useCatalogSearch(q: string, locale = 'en') {
  const trimmed = q.trim();
  return useQuery<CatalogPatternItem[]>({
    queryKey: ['catalog', 'search', trimmed, locale],
    enabled: trimmed.length >= 2,
    queryFn: () =>
      fetchCatalogJson<CatalogPatternItem[]>(
        getSurfaceKey('/v1/catalog/search', { q: trimmed, locale, limit: 25 }),
      ),
  });
}
