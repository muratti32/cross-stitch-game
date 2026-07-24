import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CreatorProfileController } from './creator-profile.controller';
import { CreatorProfileService } from './creator-profile.service';
import {
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
    CatalogModule,
    TypeOrmModule.forFeature([
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
