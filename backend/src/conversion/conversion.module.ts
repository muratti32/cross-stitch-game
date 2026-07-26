import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { PatternEntity } from '../catalog/entities';
import { CatalogModule } from '../catalog/catalog.module';
import { JobsModule } from '../jobs/jobs.module';
import { SupportModule } from '../support/support.module';
import {
  ConversionController,
  PersonalPatternPreviewsController,
  PersonalPatternArtifactsController,
} from './conversion.controller';
import { ConversionEngineClient } from './conversion-engine.client';
import { ConversionJobConsumerService } from './conversion-job-consumer.service';
import { ConversionService } from './conversion.service';
import { PatternThumbnailStagingService } from './pattern-thumbnail-staging.service';
import {
  ConversionRecipeEntity,
  PatternConversionEntity,
  PersonalPatternEntity,
} from './entities';

@Module({
  controllers: [
    ConversionController,
    PersonalPatternPreviewsController,
    PersonalPatternArtifactsController,
  ],
  exports: [ConversionEngineClient, ConversionJobConsumerService, ConversionService],
  imports: [
    TypeOrmModule.forFeature([
      ConversionRecipeEntity,
      PatternConversionEntity,
      PersonalPatternEntity,
      PatternEntity,
    ]),
    AuthModule,
    forwardRef(() => CatalogModule),
    forwardRef(() => JobsModule),
    SupportModule,
  ],
  providers: [
    ConversionEngineClient,
    ConversionJobConsumerService,
    ConversionService,
    PatternThumbnailStagingService,
  ],
})
export class ConversionModule {}
