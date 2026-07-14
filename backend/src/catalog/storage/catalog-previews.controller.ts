import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { LocalObjectStorage } from './local-object-storage';

@Controller('catalog-previews')
export class CatalogPreviewsController {
  constructor(private readonly storage: LocalObjectStorage) {}

  @Get(':key(*)')
  async getPreview(
    @Param('key') key: string,
    @Res() res: Response,
  ): Promise<void> {
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
}
