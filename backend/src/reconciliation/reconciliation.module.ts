import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from '../config/app-config.module';
import { SessionsModule } from '../sessions/sessions.module';
import { ReconciliationFindingEntity, ReconciliationRunEntity } from './entities';
import { ReconciliationService } from './reconciliation.service';

@Module({
  exports: [ReconciliationService, TypeOrmModule],
  imports: [
    AppConfigModule,
    SessionsModule,
    TypeOrmModule.forFeature([ReconciliationRunEntity, ReconciliationFindingEntity]),
  ],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}
