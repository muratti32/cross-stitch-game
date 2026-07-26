import * as fs from 'node:fs';
import * as path from 'node:path';
import { PNG } from 'pngjs';

import { PATTERN_THUMBNAIL_VARIANT_SIZE_PX } from '../../../../backend/src/conversion/pattern-thumbnail-renderer';

interface ManifestEntry {
  id: string;
}

const bundledPatternsDirectory = path.resolve(__dirname, '../../../assets/bundled-patterns');
const manifestPath = path.join(bundledPatternsDirectory, 'manifest.json');

describe('bundled browsing thumbnails', () => {
  it('ships a decodable 512px thumbnail for every bundled pattern', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ManifestEntry[];
    const expectedSize = PATTERN_THUMBNAIL_VARIANT_SIZE_PX.browsing;

    for (const entry of manifest) {
      const thumbnailPath = path.join(bundledPatternsDirectory, `${entry.id}_thumbnail.png`);

      expect(fs.existsSync(thumbnailPath)).toBe(true);

      const thumbnail = PNG.sync.read(fs.readFileSync(thumbnailPath));
      expect(thumbnail.width).toBe(expectedSize);
      expect(thumbnail.height).toBe(expectedSize);
    }
  });
});
