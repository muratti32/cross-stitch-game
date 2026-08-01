import { PatternEntity } from './entities';
import { ObjectStorage } from './storage/object-storage.interface';
import { catalogPatternObjectKeys } from './pattern-object-keys';

export function patternImageUrls(
  pattern: Pick<PatternEntity, 'id' | 'previewObjectKey' | 'thumbnailRendererVersion'>,
  storage: ObjectStorage,
): { previewUrl: string; thumbnailUrls: { browsing: string; detail: string } | null } {
  return {
    previewUrl: storage.publicUrl(pattern.previewObjectKey),
    thumbnailUrls: pattern.thumbnailRendererVersion === null ? null : {
      browsing: storage.publicUrl(catalogPatternObjectKeys(pattern.id).thumbnailBrowsing),
      detail: storage.publicUrl(catalogPatternObjectKeys(pattern.id).thumbnailDetail),
    },
  };
}
