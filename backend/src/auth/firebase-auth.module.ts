import { Module } from '@nestjs/common';

import { AuthModule } from './auth.module';
import { EmailAuthModule } from './email-auth.module';
import { FirebaseAdminIdentityVerifier } from './firebase-admin-identity.verifier';
import { FirebaseAuthController } from './firebase-auth.controller';
import { FirebaseAuthService } from './firebase-auth.service';
import { FIREBASE_IDENTITY_VERIFIER } from './firebase-identity-verifier';
import { AuthIdentitiesController } from './auth-identities.controller';

@Module({
  controllers: [FirebaseAuthController, AuthIdentitiesController],
  imports: [AuthModule, EmailAuthModule],
  providers: [
    FirebaseAdminIdentityVerifier,
    FirebaseAuthService,
    {
      provide: FIREBASE_IDENTITY_VERIFIER,
      useExisting: FirebaseAdminIdentityVerifier,
    },
  ],
})
export class FirebaseAuthModule {}
