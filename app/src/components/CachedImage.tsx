import React, { useEffect, useState } from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { sha256 } from 'js-sha256';

interface CachedImageProps {
  uri: string;
  style?: StyleProp<ImageStyle>;
}

const CACHE_SUBDIR = 'catalog-previews/';

// Pattern Previews are part of the Offline Catalog Cache: once fetched they
// render from the local cache directory so offline browsing keeps its images.
export function CachedImage({ uri, style }: CachedImageProps) {
  const [source, setSource] = useState<string>(uri);

  useEffect(() => {
    let active = true;
    setSource(uri);

    const cacheDirectory = FileSystem.cacheDirectory;
    if (!cacheDirectory) {
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
      } catch {
        // Keep the remote URI; the plain Image error state applies.
        await discardCacheEntry(localPath);
      }
    })();

    return () => {
      active = false;
    };
  }, [uri]);

  return <Image source={{ uri: source }} style={style} />;
}

async function discardCacheEntry(localPath: string): Promise<void> {
  await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => undefined);
}
