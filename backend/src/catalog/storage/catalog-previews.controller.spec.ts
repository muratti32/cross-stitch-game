import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import type { PatternEntity } from '../entities';
import { catalogPatternObjectKeys, personalPatternObjectKeys } from '../pattern-object-keys';
import type { ObjectStorage } from './object-storage.interface';
import { CatalogPreviewsController } from './catalog-previews.controller';

describe('CatalogPreviewsController', () => {
  const patternId = '33333333-3333-4333-8333-333333333333';
  let patterns: Pick<Repository<PatternEntity>, 'findOneBy'>;
  let storage: Pick<ObjectStorage, 'get'>;
  let controller: CatalogPreviewsController;
  let response: { send: jest.Mock; setHeader: jest.Mock };

  beforeEach(() => {
    patterns = { findOneBy: jest.fn() };
    storage = { get: jest.fn() };
    response = { send: jest.fn(), setHeader: jest.fn() };
    controller = new CatalogPreviewsController(
      storage as ObjectStorage,
      patterns as Repository<PatternEntity>,
    );
  });

  function catalogPattern(thumbnailRendererVersion: number | null): PatternEntity {
    return {
      id: patternId,
      thumbnailRendererVersion,
      visibility: 'catalog',
    } as PatternEntity;
  }

  it('serves a catalog Thumbnail key', async () => {
    const key = catalogPatternObjectKeys(patternId).thumbnailBrowsing;
    const bytes = Buffer.from('thumbnail');
    (patterns.findOneBy as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(catalogPattern(1));
    (storage.get as jest.Mock).mockResolvedValue(bytes);

    await controller.getPreview(key, response as never);

    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(response.send).toHaveBeenCalledWith(bytes);
  });

  it('does not expose a personal-namespace Thumbnail key', async () => {
    const key = personalPatternObjectKeys(patternId).thumbnailBrowsing;
    (patterns.findOneBy as jest.Mock).mockResolvedValue(null);

    await expect(controller.getPreview(key, response as never)).rejects.toEqual(
      new NotFoundException('Preview not found'),
    );
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('does not serve a catalog Thumbnail when no renderer version was stored', async () => {
    const key = catalogPatternObjectKeys(patternId).thumbnailDetail;
    (patterns.findOneBy as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(catalogPattern(null));

    await expect(controller.getPreview(key, response as never)).rejects.toEqual(
      new NotFoundException('Preview not found'),
    );
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('does not serve an unrelated key', async () => {
    (patterns.findOneBy as jest.Mock).mockResolvedValue(null);

    await expect(controller.getPreview('patterns/not-a-thumbnail.png', response as never)).rejects.toEqual(
      new NotFoundException('Preview not found'),
    );
    expect(storage.get).not.toHaveBeenCalled();
  });
});
