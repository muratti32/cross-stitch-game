import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StitchingSessionEntity, SessionProgressFlagEntity, ObjectRegistryEntity } from './entities';
import { PatternEntity } from '../catalog/entities';
import { SessionsService } from './sessions.service';
import { StorageReconcilerService } from './storage-reconciler.service';
import { SessionsController } from './sessions.controller';
import { ArtifactsController } from './artifacts.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { AuthModule } from '../auth/auth.module';
import { AppConfigModule } from '../config/app-config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StitchingSessionEntity,
      SessionProgressFlagEntity,
      ObjectRegistryEntity,
      PatternEntity,
    ]),
    CatalogModule,
    AuthModule,
    AppConfigModule,
  ],
  controllers: [
    SessionsController,
    ArtifactsController,
  ],
  providers: [
    SessionsService,
    StorageReconcilerService,
  ],
  exports: [
    SessionsService,
    StorageReconcilerService,
  ],
})
export class SessionsModule {}
