import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CreatorProfileController } from './creator-profile.controller';
import { CreatorProfileService } from './creator-profile.service';
import {
  CreatorProfileAuditEntity,
  CreatorProfileEntity,
} from './entities';
import { ProfileSafetyService } from './profile-safety.service';
import { ProfileTextPolicyService } from './profile-text-policy.service';

@Module({
  controllers: [CreatorProfileController],
  exports: [CreatorProfileService],
  imports: [
    AuthModule,
    CatalogModule,
    TypeOrmModule.forFeature([
      CreatorProfileEntity,
      CreatorProfileAuditEntity,
    ]),
  ],
  providers: [
    CreatorProfileService,
    ProfileSafetyService,
    ProfileTextPolicyService,
  ],
})
export class CreatorProfileModule {}
