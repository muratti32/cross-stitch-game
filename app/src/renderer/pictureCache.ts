import type { SkPicture } from '@shopify/react-native-skia';

/**
 * Maximum number of tile pictures retained per layer cache.
 * Bounds memory per ADR-0031 ("bounded caches") while keeping recently
 * visited tiles warm so scrolling back does not re-record them.
 */
export const TILE_CACHE_BUDGET = 128;

/**
 * LRU cache for recorded tile pictures.
 * Relies on Map insertion order: a get() refreshes the entry to the tail,
 * so prune() evicts from the head (least recently used) first.
 */
export class TilePictureCache {
  private readonly map = new Map<string, SkPicture>();

  get(key: string): SkPicture | undefined {
    const picture = this.map.get(key);
    if (picture !== undefined) {
      this.map.delete(key);
      this.map.set(key, picture);
    }
    return picture;
  }

  set(key: string, picture: SkPicture): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, picture);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  /**
   * Evicts least-recently-used entries until the cache fits the budget.
   * Keys in `protectedKeys` (currently visible tiles) are never evicted.
   */
  prune(protectedKeys: ReadonlySet<string>, budget: number = TILE_CACHE_BUDGET): void {
    if (this.map.size <= budget) return;
    for (const key of this.map.keys()) {
      if (this.map.size <= budget) return;
      if (!protectedKeys.has(key)) {
        this.map.delete(key);
      }
    }
  }

  clear(): void {
    this.map.clear();
  }
}
