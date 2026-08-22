import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { AccountIdentityService } from './account-identity.service';
import { AuthSessionService } from './auth-session.service';
import type { FederatedAccountAuthResponse } from './auth.types';
import { CommercePromotionService } from '../promotion/commerce-promotion.service';
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
    @Optional() private readonly commercePromotion?: CommercePromotionService,
  ) {}

  async exchange(idToken: string, guestId?: string, guestCredential?: string): Promise<FederatedAccountAuthResponse> {
    const identity = await this.verifier.verify(idToken);
    const accountId = await this.accountIdentities.createOrOpen(identity);
    const tokens = await this.sessions.issueForAccount(accountId);

    const handoff = await this.startCommercePromotion(accountId, guestId, guestCredential);
    return {
      accountId,
      email: identity.email,
      provider: identity.provider,
      ...tokens,
      ...(handoff === undefined ? {} : { commerceHandoffId: handoff.handoffId, syncingPurchases: handoff.syncingPurchases }),
    };
  }

  private readonly logger = new Logger(FirebaseAuthService.name);

  private async startCommercePromotion(accountId: string, guestId?: string, guestCredential?: string) {
    if (this.commercePromotion === undefined || guestId === undefined || guestCredential === undefined) return undefined;
    try {
      return await this.commercePromotion.start(accountId, guestId, guestCredential);
    } catch (error: unknown) {
      this.logger.warn(`Commerce promotion handoff could not be created: ${error instanceof Error ? error.message : 'unknown error'}`);
      return undefined;
    }
  }
}
