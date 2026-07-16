import { Inject, Injectable } from '@nestjs/common';

import { AccountIdentityService } from './account-identity.service';
import { AuthSessionService } from './auth-session.service';
import type { FederatedAccountAuthResponse } from './auth.types';
import {
  FIREBASE_IDENTITY_VERIFIER,
  type FirebaseIdentityVerifier,
} from './firebase-identity-verifier';

@Injectable()
export class FirebaseAuthService {
  constructor(
    @Inject(FIREBASE_IDENTITY_VERIFIER)
    private readonly verifier: FirebaseIdentityVerifier,
    private readonly accountIdentities: AccountIdentityService,
    private readonly sessions: AuthSessionService,
  ) {}

  async exchange(idToken: string): Promise<FederatedAccountAuthResponse> {
    const identity = await this.verifier.verify(idToken);
    const accountId = await this.accountIdentities.createOrOpen(identity);
    const tokens = await this.sessions.issueForAccount(accountId);

    return {
      accountId,
      email: identity.email,
      provider: identity.provider,
      ...tokens,
    };
  }
}
