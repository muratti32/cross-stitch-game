import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatternEntity, TagEntity, TagLabelEntity, StaffPickEntity } from './entities';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { LocalObjectStorage } from './storage/local-object-storage';
import { CatalogPreviewsController } from './storage/catalog-previews.controller';
import { AppConfigModule } from '../config/app-config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PatternEntity,
      TagEntity,
      TagLabelEntity,
      StaffPickEntity,
    ]),
    AppConfigModule,
  ],
  controllers: [
    CatalogController,
    CatalogPreviewsController,
  ],
  providers: [
    CatalogService,
    LocalObjectStorage,
  ],
  exports: [
    CatalogService,
    LocalObjectStorage,
  ],
})
export class CatalogModule {}
