import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminModule } from '../admin/admin.module';
import { AppConfigModule } from '../config/app-config.module';
import { DemoJobConsumerService } from './demo-job-consumer.service';
import { DemoJobsQueueService } from './demo-jobs-queue.service';
import { JobOutboxEntity, ProcessingJobEntity } from './entities';
import { JobStateTransitionService } from './job-state-transition.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobsWorkerRuntimeService } from './jobs-worker-runtime.service';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { ProcessingJobsRepository } from './processing-jobs.repository';
import { SessionsModule } from '../sessions/sessions.module';
import { ConversionModule } from '../conversion/conversion.module';
import { AiArtworkModule } from '../ai-artwork/ai-artwork.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AccountDeletionModule } from '../deletion/account-deletion.module';
import { WebhookArchiveModule } from '../webhooks';

@Module({
  controllers: [JobsController],
  exports: [
    JobStateTransitionService,
    JobsService,
    ProcessingJobsRepository,
    TypeOrmModule,
  ],
  imports: [
    TypeOrmModule.forFeature([ProcessingJobEntity, JobOutboxEntity]),
  ],
  providers: [
    JobStateTransitionService,
    JobsService,
    ProcessingJobsRepository,
  ],
})
export class JobsModule {}

@Module({
  exports: [
    DemoJobConsumerService,
    DemoJobsQueueService,
    JobsWorkerRuntimeService,
    OutboxDispatcherService,
  ],
  imports: [
    AppConfigModule,
    JobsModule,
    SessionsModule,
    forwardRef(() => require('../deletion/account-deletion.module').AccountDeletionModule),
    forwardRef(() => ConversionModule),
    forwardRef(() => AdminModule),
    forwardRef(() => AiArtworkModule),
    forwardRef(() => CatalogModule),
    WebhookArchiveModule,
  ],
  providers: [
    DemoJobConsumerService,
    DemoJobsQueueService,
    JobsWorkerRuntimeService,
    OutboxDispatcherService,
  ],
})
export class JobsWorkerModule {}
