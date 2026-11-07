import * as fs from 'fs';
import * as path from 'path';

import { BUNDLED_STARTERS } from '../../../backend/src/catalog/bundled-starters.generated';
import manifest from '../../assets/bundled-patterns/manifest.json';

const assetsDir = path.resolve(__dirname, '../../assets/bundled-patterns');

const RELEASED_STARTERS = [
  ['starter_heart', 'dc47c329-35fd-4173-9ad9-5098369beb44', '6db72edbed080c273cf7e6a33ba4362e15691ef52314aeb45a770cc88336c84d'],
  ['starter_flower', 'a6a221ab-83dd-4bc0-b945-ba619e65fa92', '81eb64ea93098e40aeb415356ede6d3956e5c86161b5bf11fef8cbf3bf4192d5'],
  ['starter_star', 'c2206f08-ef17-45d9-9cbb-ecd818a8dc06', 'fc90cb1a92c54643b20de8a62e0a5cdf7d0c899f36afebfc0d1d8142febbc468'],
  ['starter_mushroom', 'cb6dc139-74da-4668-aa23-8d692243db7a', 'b10f10eb19088eda519068d1daa6202a4f986d6797b9cd5000c40afa9d0d8fbe'],
] as const;

describe('bundled starter outputs', () => {
  it('keeps every released id on its released bytes', () => {
    expect(manifest.map(({ assetKey, id, checksum }) => [assetKey, id, checksum])).toEqual(RELEASED_STARTERS);
  });

  it('lists the same starters in the app manifest and the backend module', () => {
    expect(BUNDLED_STARTERS.map((starter) => starter.id)).toEqual(manifest.map((entry) => entry.id));
  });

  describe.each(manifest)('$assetKey', (entry) => {
    const starter = BUNDLED_STARTERS.find((candidate) => candidate.id === entry.id);

    it('carries the manifest metadata to the backend', () => {
      expect(starter).toMatchObject({
        title: entry.title,
        description: entry.description,
        width: entry.width,
        height: entry.height,
        paletteSize: entry.paletteSize,
        stitchableCellCount: entry.cellsCount,
        publishedAt: entry.createdAt,
        artifact: {
          checksum: entry.checksum,
          byteLength: entry.byteLength,
          schemaVersion: entry.schemaVersion,
        },
      });
    });

    it('embeds the bundled artifact and preview bytes', () => {
      const artifact = fs.readFileSync(path.join(assetsDir, `${entry.assetKey}.bin`));
      const preview = fs.readFileSync(path.join(assetsDir, `${entry.assetKey}.png`));

      expect(starter?.artifact.base64).toBe(artifact.toString('base64'));
      expect(starter?.previewBase64).toBe(preview.toString('base64'));
    });
  });
});
