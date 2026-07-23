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
    ],
    migrationsRun: false,
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    type: 'postgres',
    url: databaseUrl,
  };
}
