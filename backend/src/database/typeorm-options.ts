import type { DataSourceOptions } from 'typeorm';

import {
  GuestInstallationEntity,
  AuthIdentityEntity,
  EmailVerificationCodeEntity,
  RefreshTokenEntity,
  RegisteredAccountEntity,
} from '../auth/entities';
import { EmailOutboxEntity } from '../auth/email-outbox.entity';
import {
  PatternEntity,
  TagEntity,
  TagLabelEntity,
  StaffPickEntity,
  CategoryEntity,
  CommunityReportEntity,
  PostPublicationReviewEntity,
  PostPublicationReviewClosureEntity,
  CatalogWithdrawalClosureEntity,
  CatalogWithdrawalEntity,
  ModerationNoticeEntity,
  SafetyRemovalAppealEntity,
} from '../catalog/entities';
import { JobOutboxEntity, ProcessingJobEntity } from '../jobs/entities';
import {
  ConversionRecipeEntity,
  PatternConversionEntity,
  PersonalPatternEntity,
} from '../conversion/entities';
import {
  StitchingSessionEntity,
  SessionProgressFlagEntity,
  ObjectRegistryEntity,
  ProgressOperationEntity,
  SessionCellStateEntity,
  SessionCheckpointEntity,
  SessionDeviceWatermarkEntity,
  SessionSyncStateEntity,
} from '../sessions/entities';
import {
  OperatorAccountEntity,
  OperatorRecoveryCodeEntity,
  OperatorRefreshTokenEntity,
  OperatorLoginChallengeEntity,
  OperatorAuditLogEntity,
  OperatorSecurityEventEntity,
  OfficialPatternDraftEntity,
  BulkPatternRemovalEntity,
} from '../admin/entities';
import {
  CoinBalanceEntity,
  CoinLedgerEntryEntity,
  RewardDayPoolEntity,
  PatternUnlockEntity,
  GameplayEventEntity,
  DailyColorActionCountEntity,
  AiCreditBalanceEntity,
  AiCreditLedgerEntryEntity,
  CommerceTransactionBindingEntity,
  AdAttemptEntity,
} from '../economy/entities';
import {
  PromotionLockEntity,
  PromotionTransferPackageEntity,
} from '../promotion/entities';
import { CreateAuthSchema1783987200000 } from './migrations/1783987200000-CreateAuthSchema';
import { CreateJobsSchema1783900800000 } from './migrations/1783900800000-CreateJobsSchema';
import { CreateCatalogSchema1784073600000 } from './migrations/1784073600000-CreateCatalogSchema';
import { CreateSessionsSchema1784160000000 } from './migrations/1784160000000-CreateSessionsSchema';
import { CreateEmailAuthSchema1784160000001 } from './migrations/1784160000001-CreateEmailAuthSchema';
import { CreateProgressSyncSchema1784246400000 } from './migrations/1784246400000-CreateProgressSyncSchema';
import { CreatePatternConversionSchema1784332800000 } from './migrations/1784332800000-CreatePatternConversionSchema';
import { AddFederatedAuthIdentities1784419200000 } from './migrations/1784419200000-AddFederatedAuthIdentities';
import { AddCatalogTagActiveFlag1784505600000 } from './migrations/1784505600000-AddCatalogTagActiveFlag';
import { CreateAdminAuthSchema1784592000000 } from './migrations/1784592000000-CreateAdminAuthSchema';
import { CreateAdminAuditSchema1784678400000 } from './migrations/1784678400000-CreateAdminAuditSchema';
import { CreateOfficialPatternDraftsSchema1784764800000 } from './migrations/1784764800000-CreateOfficialPatternDraftsSchema';
import { CreateCatalogCategoriesSchema1784851200000 } from './migrations/1784851200000-CreateCatalogCategoriesSchema';
import { CreateEconomySchema1784937600000 } from './migrations/1784937600000-CreateEconomySchema';
import { AddFirstCompletionReason1785024000000 } from './migrations/1785024000000-AddFirstCompletionReason';
import { CreatePatternUnlocks1785110400000 } from './migrations/1785110400000-CreatePatternUnlocks';
import { CreateDailyTasks1785196800000 } from './migrations/1785196800000-CreateDailyTasks';
import { AddPersonalPatternLineage1785283200000 } from './migrations/1785283200000-AddPersonalPatternLineage';
import { CreatePromotionSchema1785369600000 } from './migrations/1785369600000-CreatePromotionSchema';
import { WidenLedgerReasonForPromotion1785456000000 } from './migrations/1785456000000-WidenLedgerReasonForPromotion';
import { WidenPackageStatusForNeedsAttention1785542400000 } from './migrations/1785542400000-WidenPackageStatusForNeedsAttention';
import { CreateCommerceLedger1785628800000 } from './migrations/1785628800000-CreateCommerceLedger';
import { CreatePremiumMembership1785801600000 } from './migrations/1785801600000-CreatePremiumMembership';
import { CreateAdAttempts1785715200000 } from './migrations/1785715200000-CreateAdAttempts';
import { CreateAiArtworkSchema1785881600000 } from './migrations/1785881600000-CreateAiArtworkSchema';
import {
  AiArtworkEntity,
  AiCreditReservationEntity,
} from '../ai-artwork/entities';
import {
  SupportReferenceEntity,
  SupportReferenceRecordEntity,
} from '../support/entities';
import { CreateSupportReferences1785974400000 } from './migrations/1785974400000-CreateSupportReferences';
import {
  CreatorProfileAppealEntity,
  CreatorProfileAuditEntity,
  CreatorProfileAuditEventEntity,
  CreatorProfileEntity,
  ProfileInvestigationEntity,
  ProfileReportEntity,
  ReservedUsernameEntity,
} from '../creator-profile/entities';
import { CreateCreatorProfiles1786060800000 } from './migrations/1786060800000-CreateCreatorProfiles';
import { CreateProfileReports1786320000000 } from './migrations/1786320000000-CreateProfileReports';
import { CreateReservedUsernames1786406400000 } from './migrations/1786406400000-CreateReservedUsernames';
import { AllowModeratorUsernameReset1786492800000 } from './migrations/1786492800000-AllowModeratorUsernameReset';
import { AddCreatorProfileRestriction1786579200000 } from './migrations/1786579200000-AddCreatorProfileRestriction';
import { CreateCreatorProfileAppeals1786665600000 } from './migrations/1786665600000-CreateCreatorProfileAppeals';
import {
  CatalogAppealEntity,
  CatalogMetadataAppealEntity,
  CatalogMetadataReviewDecisionEntity,
  CatalogMetadataRevisionEntity,
  CatalogReviewDecisionEntity,
  CatalogSubmissionEntity,
} from '../catalog/entities';
import { CreateCatalogSubmissions1786147200000 } from './migrations/1786147200000-CreateCatalogSubmissions';
import { CreateCatalogMetadataRevisions1786233600000 } from './migrations/1786233600000-CreateCatalogMetadataRevisions';
import { PatternLikeEntity, CreatorBlockEntity } from '../social/entities';
import { CreatePatternLikes1786752000000 } from './migrations/1786752000000-CreatePatternLikes';
import { CreateCreatorBlocks1786838400000 } from './migrations/1786838400000-CreateCreatorBlocks';
import {
  AccountDeletionRequestEntity,
  DeletionAuditEventEntity,
  ProviderJobTombstoneEntity,
  InvalidatedNamespaceTokenEntity,
} from '../deletion/entities';
import { CreateAccountDeletion1786924800000 } from './migrations/1786924800000-CreateAccountDeletion';
import { AddAccountClosureHold1787011200000 } from './migrations/1787011200000-AddAccountClosureHold';
import { AddAiArtworkCancelledStatus1787097600000 } from './migrations/1787097600000-AddAiArtworkCancelledStatus';
import { CreateDeletionTombstones1787184000000 } from './migrations/1787184000000-CreateDeletionTombstones';
import { CreateInvalidatedNamespaceTokens1787270400000 } from './migrations/1787270400000-CreateInvalidatedNamespaceTokens';
import { CreateWebhookDeliveryArchives1787356800000 } from './migrations/1787356800000-CreateWebhookDeliveryArchives';
import { WebhookDeliveryArchiveEntity } from '../webhooks';
import { AnalyticsGameplayEventEntity } from '../events/entities';
import { CreateAnalyticsGameplayEvents1787443200000 } from './migrations/1787443200000-CreateAnalyticsGameplayEvents';
import { CreateReconciliationFindings1787529600000 } from './migrations/1787529600000-CreateReconciliationFindings';
import { ReconciliationFindingEntity, ReconciliationRunEntity } from '../reconciliation';
import { CreateOperationalAlertRuns1787616000000 } from './migrations/1787616000000-CreateOperationalAlertRuns';
import { OperationalAlertRunEntity } from '../observability';
import { CreateCommunityReports1787702400000 } from './migrations/1787702400000-CreateCommunityReports';
import { CreateCatalogWithdrawals1787788800000 } from './migrations/1787788800000-CreateCatalogWithdrawals';
import { CreateReviewHolds1787875200000 } from './migrations/1787875200000-CreateReviewHolds';
import { CreatePostPublicationReviewFinalDecisions1787961600000 } from './migrations/1787961600000-CreatePostPublicationReviewFinalDecisions';
import { AddSafetyRemovalOutcome1788048000000 } from './migrations/1788048000000-AddSafetyRemovalOutcome';
import { CreateSafetyRemovalAppeals1788134400000 } from './migrations/1788134400000-CreateSafetyRemovalAppeals';
import { AddPatternThumbnailRendererVersion1788220800000 } from './migrations/1788220800000-AddPatternThumbnailRendererVersion';
import { AddOfficialPatternDraftThumbnailRendererVersion1788307200000 } from './migrations/1788307200000-AddOfficialPatternDraftThumbnailRendererVersion';
import { AddCommerceStoreGameplayEvents1788393600000 } from './migrations/1788393600000-AddCommerceStoreGameplayEvents';
import { CreatePremiumPurchaseReconciliations1788480000000 } from './migrations/1788480000000-CreatePremiumPurchaseReconciliations';
import { CreateCoinPackPurchaseReconciliations1788566400000 } from './migrations/1788566400000-CreateCoinPackPurchaseReconciliations';
import { CreateAiCreditPackPurchaseReconciliations1788652800000 } from './migrations/1788652800000-CreateAiCreditPackPurchaseReconciliations';
import { AddCommerceCatalogIncompleteGameplayEvent1788739200000 } from './migrations/1788739200000-AddCommerceCatalogIncompleteGameplayEvent';
import { CreateBulkPatternRemovals1788825600000 } from './migrations/1788825600000-CreateBulkPatternRemovals';
import { CreateGuestCommercePurchaseAttempts1788998400000 } from './migrations/1788998400000-CreateGuestCommercePurchaseAttempts';
import { AddCommerceOwnerToTransactionBindings1788912000000 } from './migrations/1788912000000-AddCommerceOwnerToTransactionBindings';
import { AddCommerceOwnerToPremiumMembership1789084800000 } from './migrations/1789084800000-AddCommerceOwnerToPremiumMembership';

export function createTypeOrmOptions(databaseUrl: string): DataSourceOptions {
  return {
    entities: [
      ProcessingJobEntity,
      JobOutboxEntity,
      GuestInstallationEntity,
      RegisteredAccountEntity,
      AuthIdentityEntity,
      EmailVerificationCodeEntity,
      RefreshTokenEntity,
      EmailOutboxEntity,
      PatternEntity,
      TagEntity,
      TagLabelEntity,
      StaffPickEntity,
      CategoryEntity,
      StitchingSessionEntity,
      SessionProgressFlagEntity,
      ObjectRegistryEntity,
      SessionSyncStateEntity,
      ProgressOperationEntity,
      SessionCellStateEntity,
      SessionDeviceWatermarkEntity,
      SessionCheckpointEntity,
      PatternConversionEntity,
      PersonalPatternEntity,
      ConversionRecipeEntity,
      OperatorAccountEntity,
      OperatorRecoveryCodeEntity,
      OperatorRefreshTokenEntity,
      OperatorLoginChallengeEntity,
      OperatorAuditLogEntity,
      OperatorSecurityEventEntity,
      OfficialPatternDraftEntity,
      BulkPatternRemovalEntity,
      CoinBalanceEntity,
      CoinLedgerEntryEntity,
      RewardDayPoolEntity,
      PatternUnlockEntity,
      GameplayEventEntity,
      DailyColorActionCountEntity,
      PromotionLockEntity,
      PromotionTransferPackageEntity,
      AiCreditBalanceEntity,
      AiCreditLedgerEntryEntity,
      CommerceTransactionBindingEntity,
      AdAttemptEntity,
      AiArtworkEntity,
      AiCreditReservationEntity,
      SupportReferenceEntity,
      SupportReferenceRecordEntity,
      CreatorProfileEntity,
      CreatorProfileAppealEntity,
      CreatorProfileAuditEntity,
      CreatorProfileAuditEventEntity,
      ProfileInvestigationEntity,
      ProfileReportEntity,
      ReservedUsernameEntity,
      CatalogSubmissionEntity,
      CatalogAppealEntity,
      CatalogReviewDecisionEntity,
      CatalogMetadataRevisionEntity,
      CatalogMetadataAppealEntity,
      CatalogMetadataReviewDecisionEntity,
      PatternLikeEntity,
      CreatorBlockEntity,
      AccountDeletionRequestEntity,
      DeletionAuditEventEntity,
      ProviderJobTombstoneEntity,
      InvalidatedNamespaceTokenEntity,
      WebhookDeliveryArchiveEntity,
      AnalyticsGameplayEventEntity,
      ReconciliationRunEntity,
      ReconciliationFindingEntity,
      OperationalAlertRunEntity,
      CommunityReportEntity,
      PostPublicationReviewEntity,
      PostPublicationReviewClosureEntity,
      CatalogWithdrawalClosureEntity,
      CatalogWithdrawalEntity,
      ModerationNoticeEntity,
      SafetyRemovalAppealEntity,
    ],
    migrations: [
      CreateJobsSchema1783900800000,
      CreateAuthSchema1783987200000,
      CreateCatalogSchema1784073600000,
      CreateSessionsSchema1784160000000,
      CreateEmailAuthSchema1784160000001,
      CreateProgressSyncSchema1784246400000,
      CreatePatternConversionSchema1784332800000,
      AddFederatedAuthIdentities1784419200000,
      AddCatalogTagActiveFlag1784505600000,
      CreateAdminAuthSchema1784592000000,
      CreateAdminAuditSchema1784678400000,
      CreateOfficialPatternDraftsSchema1784764800000,
      CreateCatalogCategoriesSchema1784851200000,
      CreateEconomySchema1784937600000,
      AddFirstCompletionReason1785024000000,
      CreatePatternUnlocks1785110400000,
      CreateDailyTasks1785196800000,
      AddPersonalPatternLineage1785283200000,
      CreatePromotionSchema1785369600000,
      WidenLedgerReasonForPromotion1785456000000,
      WidenPackageStatusForNeedsAttention1785542400000,
      CreateCommerceLedger1785628800000,
      CreateAdAttempts1785715200000,
      CreatePremiumMembership1785801600000,
      CreateAiArtworkSchema1785881600000,
      CreateSupportReferences1785974400000,
      CreateCreatorProfiles1786060800000,
      CreateCatalogSubmissions1786147200000,
      CreateCatalogMetadataRevisions1786233600000,
      CreateProfileReports1786320000000,
      CreateReservedUsernames1786406400000,
      AllowModeratorUsernameReset1786492800000,
      AddCreatorProfileRestriction1786579200000,
      CreateCreatorProfileAppeals1786665600000,
      CreatePatternLikes1786752000000,
      CreateCreatorBlocks1786838400000,
      CreateAccountDeletion1786924800000,
      AddAccountClosureHold1787011200000,
      AddAiArtworkCancelledStatus1787097600000,
      CreateDeletionTombstones1787184000000,
      CreateInvalidatedNamespaceTokens1787270400000,
      CreateWebhookDeliveryArchives1787356800000,
      CreateAnalyticsGameplayEvents1787443200000,
      CreateReconciliationFindings1787529600000,
      CreateOperationalAlertRuns1787616000000,
      CreateCommunityReports1787702400000,
      CreateCatalogWithdrawals1787788800000,
      CreateReviewHolds1787875200000,
      CreatePostPublicationReviewFinalDecisions1787961600000,
      AddSafetyRemovalOutcome1788048000000,
      CreateSafetyRemovalAppeals1788134400000,
      AddPatternThumbnailRendererVersion1788220800000,
      AddOfficialPatternDraftThumbnailRendererVersion1788307200000,
      AddCommerceStoreGameplayEvents1788393600000,
      CreatePremiumPurchaseReconciliations1788480000000,
      CreateCoinPackPurchaseReconciliations1788566400000,
      CreateAiCreditPackPurchaseReconciliations1788652800000,
      AddCommerceCatalogIncompleteGameplayEvent1788739200000,
      CreateBulkPatternRemovals1788825600000,
      AddCommerceOwnerToTransactionBindings1788912000000,
      CreateGuestCommercePurchaseAttempts1788998400000,
      AddCommerceOwnerToPremiumMembership1789084800000,
    ],
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    type: 'postgres',
    url: databaseUrl,
  };
}
