import { Module } from '@nestjs/common';

import { AuthModule } from './auth.module';
import { EmailAuthModule } from './email-auth.module';
import { FirebaseAdminIdentityVerifier } from './firebase-admin-identity.verifier';
import { FirebaseAuthController } from './firebase-auth.controller';
import { FirebaseAuthService } from './firebase-auth.service';
import { FIREBASE_IDENTITY_VERIFIER } from './firebase-identity-verifier';
import { AccountReauthenticationController } from './account-reauthentication.controller';
import { AccountReauthenticationService } from './account-reauthentication.service';
import { AuthIdentitiesController } from './auth-identities.controller';
import { PromotionModule } from '../promotion/promotion.module';

@Module({
  controllers: [
    FirebaseAuthController,
    AuthIdentitiesController,
    AccountReauthenticationController,
  ],
  imports: [AuthModule, EmailAuthModule, PromotionModule],
  providers: [
    AccountReauthenticationService,
    FirebaseAdminIdentityVerifier,
    FirebaseAuthService,
    {
      provide: FIREBASE_IDENTITY_VERIFIER,
      useExisting: FirebaseAdminIdentityVerifier,
    },
  ],
})
export class FirebaseAuthModule {}
