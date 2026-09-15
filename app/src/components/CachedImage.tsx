import React, { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { sha256 } from 'js-sha256';

import { imageResourceIdentity } from './imageResourceIdentity';
import { captureCachedImageError } from '../observability/sentry';

interface CachedImageProps {
  uri: string;
  style?: StyleProp<ImageStyle>;
  resizeMethod?: 'auto' | 'resize' | 'scale';
}

const CACHE_SUBDIR = 'catalog-previews/';
const MAX_DISK_CACHE_ENTRIES = 100;
const mountedCachedPaths = new Map<string, number>();

// Pattern Previews are part of the Offline Catalog Cache: once fetched they
// render from the local cache directory so offline browsing keeps its images.
export function CachedImage({ uri, style, resizeMethod = 'resize' }: CachedImageProps) {
  const [source, setSource] = useState<string>(uri);
  const resourceIdentity = imageResourceIdentity(uri);

  useEffect(() => {
    let active = true;

    const cacheDirectory = FileSystem.cacheDirectory;
    if (!cacheDirectory) {
      setSource(uri);
      return;
    }
    const dir = `${cacheDirectory}${CACHE_SUBDIR}`;
    const localPath = `${dir}${sha256(uri)}.img`;
    retainCachedPath(localPath);

    (async () => {
      try {
        const info = await FileSystem.getInfoAsync(localPath);
        if (info.exists) {
          // The legacy API has no cheap modification-time setter; persisted
          // modificationTime is therefore the LRU signal.
          if (active) {
            setSource(localPath);
          }
          return;
        }
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(
          () => undefined,
        );
        const result = await FileSystem.downloadAsync(uri, localPath);
        if (result.status !== 200) {
          // downloadAsync writes the response body to disk whatever the status,
          // so an expired signed grant (403) would otherwise leave an error page
          // behind that every later render treats as a valid cache hit.
          await discardCacheEntry(localPath);
          return;
        }
        if (active) {
          setSource(result.uri);
        }
        // Bound disk cache footprint
        void pruneDiskCacheIfNeeded(dir);
      } catch (error: unknown) {
        // Keep the remote URI; the plain Image error state applies.
        await discardCacheEntry(localPath);
        captureCachedImageError('cache-download', error);
      }
    })();

    return () => {
      active = false;
      releaseCachedPath(localPath);
    };
  // A refreshed private grant changes exp/sig, not the image. Keeping the
  // resource identity stable prevents an already visible image from blinking.
  // A remount still receives the newest, valid grant.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceIdentity]);

  return <Image source={{ uri: source }} style={style} resizeMethod={resizeMethod} />;
}

async function discardCacheEntry(localPath: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(localPath, { idempotent: true });
  } catch (error: unknown) {
    captureCachedImageError('discard-cache-entry', error);
  }
}

export async function pruneDiskCacheIfNeeded(dir: string): Promise<void> {
  try {
    const files = await FileSystem.readDirectoryAsync(dir);
    if (files.length <= MAX_DISK_CACHE_ENTRIES) return;

    const entries = (
      await Promise.all(
        files.map(async (file) => {
          const path = `${dir}${file}`;
          const info = await FileSystem.getInfoAsync(path);
          if (!info.exists || info.isDirectory) return null;
          return { path, modificationTime: info.modificationTime };
        }),
      )
    )
      .filter((entry): entry is { path: string; modificationTime: number } => entry !== null)
      .sort((left, right) => left.modificationTime - right.modificationTime);

    let remaining = files.length - MAX_DISK_CACHE_ENTRIES;
    for (const entry of entries) {
      if (remaining <= 0) break;
      if (mountedCachedPaths.has(entry.path)) continue;
      await FileSystem.deleteAsync(entry.path, { idempotent: true });
      remaining -= 1;
    }
  } catch (error: unknown) {
    captureCachedImageError('prune-disk-cache', error);
  }
}

export function retainCachedPath(path: string): void {
  mountedCachedPaths.set(path, (mountedCachedPaths.get(path) ?? 0) + 1);
}

export function releaseCachedPath(path: string): void {
  const count = mountedCachedPaths.get(path);
  if (count === undefined || count <= 1) {
    mountedCachedPaths.delete(path);
  } else {
    mountedCachedPaths.set(path, count - 1);
  }
}
