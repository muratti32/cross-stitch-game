import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from '../config/app-config.module';
import { JobOutboxEntity, ProcessingJobEntity } from '../jobs/entities';
import { JobStateTransitionService } from '../jobs/job-state-transition.service';
import { PromotionTransferPackageEntity } from '../promotion/entities';
import { WebhookArchiveModule } from '../webhooks';
import { OperationalAlertRunEntity } from './entities';
import { OperationalAlertsEvaluatorService } from './operational-alerts-evaluator.service';
import { OperationalAlertsService } from './operational-alerts.service';

// Depends on entity classes and the stateless JobStateTransitionService
// directly, not on JobsModule/JobsWorkerModule, so this module can be
// imported from both the worker (JobsWorkerModule) and the API (AdminModule)
// deployables without an import cycle back through jobs.module.ts.
@Module({
  exports: [OperationalAlertsEvaluatorService, OperationalAlertsService, TypeOrmModule],
  imports: [
    AppConfigModule,
    WebhookArchiveModule,
    TypeOrmModule.forFeature([
      ProcessingJobEntity,
      JobOutboxEntity,
      PromotionTransferPackageEntity,
      OperationalAlertRunEntity,
    ]),
  ],
  providers: [
    JobStateTransitionService,
    OperationalAlertsEvaluatorService,
    OperationalAlertsService,
  ],
})
export class ObservabilityAlertsModule {}
