import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CatalogAppealEntity,
  CatalogMetadataAppealEntity,
  CatalogMetadataReviewDecisionEntity,
  CatalogMetadataRevisionEntity,
  CatalogReviewDecisionEntity,
  CatalogSubmissionEntity,
  PatternEntity,
  TagEntity,
  TagLabelEntity,
  StaffPickEntity,
  CategoryEntity,
  CommunityReportEntity,
  PostPublicationReviewEntity,
  CatalogWithdrawalClosureEntity,
  CatalogWithdrawalEntity,
} from './entities';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { LocalObjectStorage } from './storage/local-object-storage';
import { R2ObjectStorage } from './storage/r2-object-storage';
import { OBJECT_STORAGE, ObjectStorage } from './storage/object-storage.interface';
import { CatalogPreviewsController } from './storage/catalog-previews.controller';
import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { CreatorProfileEntity } from '../creator-profile/entities';
import { CatalogSubmissionController } from './catalog-submission.controller';
import { CatalogSubmissionService } from './catalog-submission.service';
import { CatalogPrecheckService } from './catalog-precheck.service';
import { CatalogPrecheckJobConsumerService } from './catalog-precheck-job-consumer.service';
import { CatalogMetadataRevisionController } from './catalog-metadata-revision.controller';
import { CatalogMetadataRevisionService } from './catalog-metadata-revision.service';
import { CommunityReportController } from './community-report.controller';
import { CommunityReportService } from './community-report.service';
import { CatalogWithdrawalController } from './catalog-withdrawal.controller';
import { CatalogWithdrawalService } from './catalog-withdrawal.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PatternEntity,
      TagEntity,
      TagLabelEntity,
      StaffPickEntity,
      CategoryEntity,
      CatalogSubmissionEntity,
      CatalogAppealEntity,
      CatalogReviewDecisionEntity,
      CatalogMetadataRevisionEntity,
      CatalogMetadataAppealEntity,
      CatalogMetadataReviewDecisionEntity,
      CreatorProfileEntity,
      CommunityReportEntity,
      PostPublicationReviewEntity,
      CatalogWithdrawalClosureEntity,
      CatalogWithdrawalEntity,
    ]),
    AppConfigModule,
    AuthModule,
    forwardRef(() => JobsModule),
  ],
  controllers: [
    CatalogController,
    CatalogPreviewsController,
    CatalogSubmissionController,
    CatalogMetadataRevisionController,
    CommunityReportController,
    CatalogWithdrawalController,
  ],
  providers: [
    CatalogService,
    CatalogSubmissionService,
    CatalogMetadataRevisionService,
    CatalogPrecheckService,
    CatalogPrecheckJobConsumerService,
    CommunityReportService,
    CatalogWithdrawalService,
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
    CatalogSubmissionService,
    CatalogMetadataRevisionService,
    CatalogPrecheckJobConsumerService,
    OBJECT_STORAGE,
  ],
})
export class CatalogModule {}
