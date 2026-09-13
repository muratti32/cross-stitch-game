import React, { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { sha256 } from 'js-sha256';

import { imageResourceIdentity } from './imageResourceIdentity';

interface CachedImageProps {
  uri: string;
  style?: StyleProp<ImageStyle>;
  resizeMethod?: 'auto' | 'resize' | 'scale';
  variant?: 'browsing' | 'detail';
}

const CACHE_SUBDIR = 'catalog-previews/';
const MAX_DISK_CACHE_ENTRIES = 100;

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

    (async () => {
      try {
        const info = await FileSystem.getInfoAsync(localPath);
        if (info.exists) {
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
      } catch {
        // Keep the remote URI; the plain Image error state applies.
        await discardCacheEntry(localPath);
      }
    })();

    return () => {
      active = false;
    };
  // A refreshed private grant changes exp/sig, not the image. Keeping the
  // resource identity stable prevents an already visible image from blinking.
  // A remount still receives the newest, valid grant.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceIdentity]);

  return <Image source={{ uri: source }} style={style} resizeMethod={resizeMethod} />;
}

async function discardCacheEntry(localPath: string): Promise<void> {
  await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => undefined);
}

async function pruneDiskCacheIfNeeded(dir: string): Promise<void> {
  try {
    const files = await FileSystem.readDirectoryAsync(dir);
    if (files.length <= MAX_DISK_CACHE_ENTRIES) return;
    const toRemove = files.slice(0, files.length - MAX_DISK_CACHE_ENTRIES);
    await Promise.all(
      toRemove.map((file) =>
        FileSystem.deleteAsync(`${dir}${file}`, { idempotent: true }).catch(() => undefined),
      ),
    );
  } catch {
    // best effort cache eviction
  }
}
