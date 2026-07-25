import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { AnalyticsGameplayEventEntity } from './entities';
import { EventsController } from './events.controller';
import { EventsPartitionService } from './events-partition.service';
import { EventsService } from './events.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([AnalyticsGameplayEventEntity])],
  controllers: [EventsController],
  providers: [EventsPartitionService, EventsService],
  exports: [EventsPartitionService, EventsService],
})
export class EventsModule {}
