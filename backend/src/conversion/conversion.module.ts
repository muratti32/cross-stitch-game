import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { PatternEntity } from '../catalog/entities';
import { CatalogModule } from '../catalog/catalog.module';
import { JobsModule } from '../jobs/jobs.module';
import {
  ConversionController,
  PersonalPatternPreviewsController,
} from './conversion.controller';
import { ConversionEngineClient } from './conversion-engine.client';
import { ConversionJobConsumerService } from './conversion-job-consumer.service';
import { ConversionService } from './conversion.service';
import {
  ConversionRecipeEntity,
  PatternConversionEntity,
  PersonalPatternEntity,
} from './entities';

@Module({
  controllers: [ConversionController, PersonalPatternPreviewsController],
  exports: [ConversionJobConsumerService, ConversionService],
  imports: [
    TypeOrmModule.forFeature([
      ConversionRecipeEntity,
      PatternConversionEntity,
      PersonalPatternEntity,
      PatternEntity,
    ]),
    AuthModule,
    CatalogModule,
    forwardRef(() => JobsModule),
  ],
  providers: [
    ConversionEngineClient,
    ConversionJobConsumerService,
    ConversionService,
  ],
})
export class ConversionModule {}
