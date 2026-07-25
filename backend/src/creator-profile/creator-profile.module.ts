import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CreatorProfileController } from './creator-profile.controller';
import { CreatorProfileService } from './creator-profile.service';
import {
  CreatorProfileAppealEntity,
  CreatorProfileAuditEntity,
  CreatorProfileAuditEventEntity,
  CreatorProfileEntity,
  ProfileInvestigationEntity,
  ProfileReportEntity,
  ReservedUsernameEntity,
} from './entities';
import { ProfileReportController } from './profile-report.controller';
import { ProfileReportService } from './profile-report.service';
import { ProfileSafetyService } from './profile-safety.service';
import { ProfileTextPolicyService } from './profile-text-policy.service';

@Module({
  controllers: [CreatorProfileController, ProfileReportController],
  exports: [CreatorProfileService, ProfileReportService],
  imports: [
    AuthModule,
    // Catalog imports Social, which imports Catalog back; entering that cycle
    // from here needs the lazy edge too.
    forwardRef(() => CatalogModule),
    TypeOrmModule.forFeature([
      CreatorProfileAppealEntity,
      CreatorProfileEntity,
      CreatorProfileAuditEntity,
      CreatorProfileAuditEventEntity,
      ProfileInvestigationEntity,
      ProfileReportEntity,
      ReservedUsernameEntity,
    ]),
  ],
  providers: [
    CreatorProfileService,
    ProfileReportService,
    ProfileSafetyService,
    ProfileTextPolicyService,
  ],
})
export class CreatorProfileModule {}
