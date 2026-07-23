import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  ObjectRegistryEntity,
  ProgressOperationEntity,
  SessionCellStateEntity,
  SessionCheckpointEntity,
  SessionDeviceWatermarkEntity,
  SessionProgressFlagEntity,
  SessionSyncStateEntity,
  StitchingSessionEntity,
} from './entities';
import { PatternEntity } from '../catalog/entities';
import { SessionsService } from './sessions.service';
import { StorageReconcilerService } from './storage-reconciler.service';
import { SessionsController } from './sessions.controller';
import { ArtifactsController } from './artifacts.controller';
import { ProgressSyncController } from './progress-sync.controller';
import { ProgressCheckpointService } from './progress-checkpoint.service';
import { ProgressSyncService } from './progress-sync.service';
import { CatalogModule } from '../catalog/catalog.module';
import { AuthModule } from '../auth/auth.module';
import { AppConfigModule } from '../config/app-config.module';
import { EconomyModule } from '../economy/economy.module';
import { PromotionModule } from '../promotion/promotion.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StitchingSessionEntity,
      SessionProgressFlagEntity,
      ObjectRegistryEntity,
      SessionSyncStateEntity,
      ProgressOperationEntity,
      SessionCellStateEntity,
      SessionDeviceWatermarkEntity,
      SessionCheckpointEntity,
      PatternEntity,
    ]),
    forwardRef(() => CatalogModule),
    AuthModule,
    AppConfigModule,
    EconomyModule,
    PromotionModule,
  ],
  controllers: [
    SessionsController,
    ArtifactsController,
    ProgressSyncController,
  ],
  providers: [
    SessionsService,
    StorageReconcilerService,
    ProgressSyncService,
    ProgressCheckpointService,
  ],
  exports: [
    SessionsService,
    StorageReconcilerService,
  ],
})
export class SessionsModule {}
