import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from '../config/app-config.module';
import { AppConfigService } from '../config/app-config.service';
import { CatalogModule } from '../catalog/catalog.module';
import { PatternEntity, TagEntity, TagLabelEntity, StaffPickEntity, CategoryEntity } from '../catalog/entities';
import { ConversionModule } from '../conversion/conversion.module';
import { CreatorProfileModule } from '../creator-profile/creator-profile.module';
import { JobsModule } from '../jobs/jobs.module';
import { SupportModule } from '../support/support.module';
import { ADMIN_JWT_AUDIENCE, ADMIN_JWT_ISSUER } from './admin.constants';
import { AdminAuthController } from './admin-auth.controller';
import { AdminCatalogMetadataRevisionsController } from './admin-catalog-metadata-revisions.controller';
import { AdminCatalogSubmissionsController } from './admin-catalog-submissions.controller';
import { AdminCreatorRestrictionAppealsController } from './admin-creator-restriction-appeals.controller';
import { AdminProfileInvestigationsController } from './admin-profile-investigations.controller';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminPatternsController } from './admin-patterns.controller';
import { AdminStaffPicksController } from './admin-staff-picks.controller';
import { AdminSupportReferencesController } from './admin-support-references.controller';
import { AdminTagsController } from './admin-tags.controller';
import { AdminWebhookDeliveriesController } from './admin-webhook-deliveries.controller';
import {
  OperatorAccountEntity,
  OperatorAuditLogEntity,
  OperatorLoginChallengeEntity,
  OperatorRecoveryCodeEntity,
  OperatorRefreshTokenEntity,
  OperatorSecurityEventEntity,
  OfficialPatternDraftEntity,
} from './entities';
import { OfficialPatternDraftJobConsumerService } from './official-pattern-draft-job-consumer.service';
import { OfficialPatternDraftsController } from './official-pattern-drafts.controller';
import { OfficialPatternDraftsService } from './official-pattern-drafts.service';
import { OperatorAuditLogService } from './operator-audit-log.service';
import { OperatorAuthGuard } from './operator-auth.guard';
import { OperatorAuthRateLimiterService } from './operator-auth-rate-limiter.service';
import { OperatorAuthService } from './operator-auth.service';
import { OperatorHashingService } from './operator-hashing.service';
import { OperatorPermissionsGuard } from './operator-permissions.guard';
import { OperatorProvisioningService } from './operator-provisioning.service';
import { OperatorRefreshTokensRepository } from './operator-refresh-tokens.repository';
import { OperatorSecurityEventsService } from './operator-security-events.service';
import { OperatorTotpService } from './operator-totp.service';
import { TotpSecretCipherService } from './totp-secret-cipher.service';
import { WebhookArchiveModule } from '../webhooks';
import { WebhookDeliveriesAdminService } from './webhook-deliveries-admin.service';

@Module({
  controllers: [
    AdminAuthController,
    AdminCatalogMetadataRevisionsController,
    AdminCatalogSubmissionsController,
    AdminCreatorRestrictionAppealsController,
    AdminProfileInvestigationsController,
    AdminCategoriesController,
    AdminPatternsController,
    AdminStaffPicksController,
    AdminSupportReferencesController,
    AdminTagsController,
    AdminWebhookDeliveriesController,
    OfficialPatternDraftsController,
  ],
  exports: [
    // Consumed by JobsWorkerModule to wire the official-pattern-draft job
    // type into the shared BullMQ worker (see DemoJobConsumerService).
    OfficialPatternDraftJobConsumerService,
    OperatorProvisioningService,
  ],
  imports: [
    AppConfigModule,
    TypeOrmModule.forFeature([
      OperatorAccountEntity,
      OperatorRecoveryCodeEntity,
      OperatorRefreshTokenEntity,
      OperatorLoginChallengeEntity,
      OperatorAuditLogEntity,
      OperatorSecurityEventEntity,
      OfficialPatternDraftEntity,
      PatternEntity,
      TagEntity,
      TagLabelEntity,
      StaffPickEntity,
      CategoryEntity,
    ]),
    // A separate JwtModule instance (own secret, issuer, audience) scoped to
    // this module only: OperatorAuthGuard's JwtService can never be the same
    // instance the player JwtAuthGuard uses (see AuthModule).
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.adminJwtSecret,
        signOptions: {
          algorithm: 'HS256' as const,
          audience: ADMIN_JWT_AUDIENCE,
          expiresIn: config.adminJwtAccessTtlSeconds,
          issuer: ADMIN_JWT_ISSUER,
        },
        verifyOptions: {
          algorithms: ['HS256' as const],
          audience: ADMIN_JWT_AUDIENCE,
          issuer: ADMIN_JWT_ISSUER,
        },
      }),
    }),
    forwardRef(() => CatalogModule),
    ConversionModule,
    CreatorProfileModule,
    forwardRef(() => JobsModule),
    SupportModule,
    WebhookArchiveModule,
  ],
  providers: [
    AdminCatalogService,
    OfficialPatternDraftJobConsumerService,
    OfficialPatternDraftsService,
    OperatorAuditLogService,
    OperatorAuthGuard,
    OperatorAuthRateLimiterService,
    OperatorAuthService,
    OperatorHashingService,
    OperatorPermissionsGuard,
    OperatorProvisioningService,
    OperatorRefreshTokensRepository,
    OperatorSecurityEventsService,
    OperatorTotpService,
    TotpSecretCipherService,
    WebhookDeliveriesAdminService,
  ],
})
export class AdminModule {}
