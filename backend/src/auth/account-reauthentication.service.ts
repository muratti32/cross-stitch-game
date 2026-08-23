import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

import {
  AccountIdentityService,
  AuthIdentityProvider,
} from './account-identity.service';
import { AuthSessionService } from './auth-session.service';
import { AuthPrincipal } from './auth.types';
import {
  EmailOtpService,
  EmailReauthenticationOutcome,
} from './email-otp.service';
import { PrincipalType } from './entities';
import {
  FIREBASE_IDENTITY_VERIFIER,
  FirebaseIdentityVerifier,
  FirebaseProviderIdentity,
} from './firebase-identity-verifier';

export type DeletionReauthenticationFailureReason =
  | 'different_account'
  | 'provider_rejected';

export interface LinkedAuthIdentity {
  email: string | null;
  provider: AuthIdentityProvider;
}

export interface AccountReauthenticationResult {
  accessToken: string;
  accountId: string;
  provider: AuthIdentityProvider;
  refreshToken: string;
}

/**
 * Same-account reauthentication for Account Deletion Request.
 *
 * The caller is already an authenticated Registered Account. Any Auth Identity
 * linked to that same account may prove recency, but the verified identity must
 * resolve to the already-authenticated account: an identity belonging to a
 * different account — or to no account at all — is rejected without creating,
 * adopting, linking, or switching accounts. Success issues a fresh Game Backend
 * session whose `authTime` is now, which satisfies the existing recent-auth
 * requirement enforced by AccountDeletionService.
 */
@Injectable()
export class AccountReauthenticationService {
  private readonly logger = new Logger(AccountReauthenticationService.name);

  constructor(
    private readonly accountIdentities: AccountIdentityService,
    private readonly emailOtp: EmailOtpService,
    private readonly sessions: AuthSessionService,
    @Inject(FIREBASE_IDENTITY_VERIFIER)
    private readonly firebaseVerifier: FirebaseIdentityVerifier,
  ) {}

  async withFirebaseIdToken(
    principal: AuthPrincipal,
    idToken: string,
  ): Promise<AccountReauthenticationResult> {
    this.ensureAccountPrincipal(principal, 'firebase');

    let verified: FirebaseProviderIdentity;
    try {
      verified = await this.firebaseVerifier.verify(idToken);
    } catch {
      this.rejectProvider(
        'firebase',
        'That sign-in could not be verified. Try again.',
      );
    }

    const accountId = await this.accountIdentities.findAccountIdForIdentity(
      verified.provider,
      verified.subject,
    );
    this.ensureSameAccount(principal, accountId, verified.provider);

    return {
      ...(await this.sessions.issueForAccount(principal.id)),
      accountId: principal.id,
      provider: verified.provider,
    };
  }

  async withEmailOtp(
    principal: AuthPrincipal,
    email: string,
    code: string,
  ): Promise<AccountReauthenticationResult> {
    this.ensureAccountPrincipal(principal, 'email');

    const outcome: EmailReauthenticationOutcome =
      await this.emailOtp.verifyForReauthentication(email, code);
    if (outcome.kind === 'invalid-code') {
      this.rejectProvider(
        'email',
        'That code is incorrect or has expired. Request a new one.',
      );
    }

    this.ensureSameAccount(principal, outcome.accountId, 'email');

    return {
      ...(await this.sessions.issueForAccount(principal.id)),
      accountId: principal.id,
      provider: 'email',
    };
  }

  /**
   * The providers the account can actually reauthenticate with. Only the
   * provider and its contact email are returned: the provider subject is a raw
   * identity identifier and never leaves the Game Backend.
   */
  async listLinkedIdentities(
    principal: AuthPrincipal,
  ): Promise<readonly LinkedAuthIdentity[]> {
    this.ensureAccountPrincipal(principal, 'listing');
    return this.accountIdentities.listForAccount(principal.id);
  }

  private ensureAccountPrincipal(
    principal: AuthPrincipal,
    provider: string,
  ): void {
    if (principal.type !== PrincipalType.Account) {
      this.logger.warn(
        `Deletion reauthentication rejected: principal is not a Registered Account (provider=${provider})`,
      );
      throw new ForbiddenException(
        'Only a signed-in account can reauthenticate for deletion.',
      );
    }
  }

  private ensureSameAccount(
    principal: AuthPrincipal,
    resolvedAccountId: string | null,
    provider: string,
  ): void {
    if (resolvedAccountId === null || resolvedAccountId !== principal.id) {
      this.logger.warn(
        `Deletion reauthentication rejected: identity resolves to a different account (provider=${provider})`,
      );
      const reason: DeletionReauthenticationFailureReason = 'different_account';
      throw new ForbiddenException({
        message:
          'That sign-in belongs to a different account. Use a sign-in method linked to the account you are deleting.',
        reason,
      });
    }
  }

  private rejectProvider(provider: string, message: string): never {
    this.logger.warn(
      `Deletion reauthentication rejected: provider verification failed (provider=${provider})`,
    );
    const reason: DeletionReauthenticationFailureReason = 'provider_rejected';
    throw new UnauthorizedException({ message, reason });
  }
}
