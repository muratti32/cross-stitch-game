import { Controller, Get, Inject, Param, Res, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { Repository } from 'typeorm';
import { PatternEntity } from '../entities';
import { catalogPatternObjectKeys } from '../pattern-object-keys';
import { OBJECT_STORAGE, ObjectStorage } from './object-storage.interface';

@Controller('catalog-previews')
export class CatalogPreviewsController {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @InjectRepository(PatternEntity)
    private readonly patterns: Repository<PatternEntity>,
  ) {}

  @Get(':key(*)')
  async getPreview(
    @Param('key') key: string,
    @Res() res: Response,
  ): Promise<void> {
    const previewPattern = await this.patterns.findOneBy({
      previewObjectKey: key,
      visibility: 'catalog',
    });
    if (previewPattern === null && !(await this.isCatalogThumbnailKey(key))) {
      throw new NotFoundException('Preview not found');
    }
    const data = await this.storage.get(key);
    if (!data) {
      throw new NotFoundException('Preview not found');
    }
    const contentType = key.endsWith('.png')
      ? 'image/png'
      : key.endsWith('.webp')
      ? 'image/webp'
      : 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.send(data);
  }

  private async isCatalogThumbnailKey(key: string): Promise<boolean> {
    const match = /^patterns\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/thumbnail-(browsing|detail)\.png$/i.exec(
      key,
    );
    if (match === null) {
      return false;
    }
    const [, id, variant] = match;
    const pattern = await this.patterns.findOneBy({ id, visibility: 'catalog' });
    if (pattern === null || pattern.thumbnailRendererVersion === null) {
      return false;
    }
    const keys = catalogPatternObjectKeys(pattern.id);
    return key === (variant === 'browsing' ? keys.thumbnailBrowsing : keys.thumbnailDetail);
  }
}
