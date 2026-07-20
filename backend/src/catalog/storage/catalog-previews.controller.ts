import { Controller, Get, Inject, Param, Res, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Response } from 'express';
import { Repository } from 'typeorm';
import { PatternEntity } from '../entities';
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
    const publicPattern = await this.patterns.findOneBy({
      previewObjectKey: key,
      visibility: 'catalog',
    });
    if (publicPattern === null) {
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
}
