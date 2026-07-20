import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PatternEntity, TagEntity, TagLabelEntity, StaffPickEntity, CategoryEntity } from './entities';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { LocalObjectStorage } from './storage/local-object-storage';
import { R2ObjectStorage } from './storage/r2-object-storage';
import { OBJECT_STORAGE, ObjectStorage } from './storage/object-storage.interface';
import { CatalogPreviewsController } from './storage/catalog-previews.controller';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PatternEntity,
      TagEntity,
      TagLabelEntity,
      StaffPickEntity,
      CategoryEntity,
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
    R2ObjectStorage,
    {
      provide: OBJECT_STORAGE,
      inject: [AppConfigService, LocalObjectStorage, R2ObjectStorage],
      useFactory: (
        config: AppConfigService,
        local: LocalObjectStorage,
        r2: R2ObjectStorage,
      ): ObjectStorage => (config.r2BucketName === undefined ? local : r2),
    },
  ],
  exports: [
    CatalogService,
    OBJECT_STORAGE,
  ],
})
export class CatalogModule {}
