import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import {
  AccountIdentityService,
  AuthIdentityProvider,
  VerifiedAuthIdentity,
} from './account-identity.service';
import { AccountReauthenticationService } from './account-reauthentication.service';
import { AuthSessionService } from './auth-session.service';
import { AuthPrincipal, AuthTokenPair } from './auth.types';
import {
  EmailOtpService,
  EmailReauthenticationOutcome,
} from './email-otp.service';
import { PrincipalType } from './entities';
import { FirebaseProviderIdentity } from './firebase-identity-verifier';

interface AccountIdentityStub {
  createOrOpen: jest.Mock<Promise<string>, [VerifiedAuthIdentity]>;
  findAccountIdForIdentity: jest.Mock<
    Promise<string | null>,
    [AuthIdentityProvider, string]
  >;
  link: jest.Mock<Promise<void>, [string, VerifiedAuthIdentity]>;
}

interface EmailOtpStub {
  verifyForReauthentication: jest.Mock<
    Promise<EmailReauthenticationOutcome>,
    [string, string]
  >;
}

interface SessionStub {
  issueForAccount: jest.Mock<Promise<AuthTokenPair>, [string]>;
}

interface FirebaseVerifierStub {
  verify: jest.Mock<Promise<FirebaseProviderIdentity>, [string]>;
}

interface TestContext {
  accountIdentities: AccountIdentityStub;
  emailOtp: EmailOtpStub;
  firebaseVerifier: FirebaseVerifierStub;
  service: AccountReauthenticationService;
  sessions: SessionStub;
}

const accountPrincipal: AuthPrincipal = {
  id: 'account-current',
  tokenVersion: 1,
  type: PrincipalType.Account,
};

const guestPrincipal: AuthPrincipal = {
  id: 'guest-current',
  tokenVersion: 1,
  type: PrincipalType.Guest,
};

const tokenPair: AuthTokenPair = {
  accessToken: 'fresh-access-token',
  refreshToken: 'fresh-refresh-token',
};

function createContext(): TestContext {
  const accountIdentities: AccountIdentityStub = {
    createOrOpen: jest.fn<Promise<string>, [VerifiedAuthIdentity]>(),
    findAccountIdForIdentity: jest.fn<
      Promise<string | null>,
      [AuthIdentityProvider, string]
    >(),
    link: jest.fn<Promise<void>, [string, VerifiedAuthIdentity]>(),
  };
  const emailOtp: EmailOtpStub = {
    verifyForReauthentication: jest.fn<
      Promise<EmailReauthenticationOutcome>,
      [string, string]
    >(),
  };
  const sessions: SessionStub = {
    issueForAccount: jest
      .fn<Promise<AuthTokenPair>, [string]>()
      .mockResolvedValue(tokenPair),
  };
  const firebaseVerifier: FirebaseVerifierStub = {
    verify: jest.fn<Promise<FirebaseProviderIdentity>, [string]>(),
  };

  const service = new AccountReauthenticationService(
    accountIdentities as unknown as AccountIdentityService,
    emailOtp as unknown as EmailOtpService,
    sessions as unknown as AuthSessionService,
    firebaseVerifier,
  );

  return { accountIdentities, emailOtp, firebaseVerifier, service, sessions };
}

describe('AccountReauthenticationService', () => {
  it('reauthenticates with an Apple identity linked to the same account', async () => {
    const context = createContext();
    context.firebaseVerifier.verify.mockResolvedValue({
      email: null,
      provider: 'apple',
      subject: 'apple-subject',
    });
    context.accountIdentities.findAccountIdForIdentity.mockResolvedValue(
      accountPrincipal.id,
    );

    await expect(
      context.service.withFirebaseIdToken(
        accountPrincipal,
        'valid-apple-id-token',
      ),
    ).resolves.toEqual({
      ...tokenPair,
      accountId: accountPrincipal.id,
      provider: 'apple',
    });
    expect(context.sessions.issueForAccount).toHaveBeenCalledWith(
      accountPrincipal.id,
    );
  });

  it('reauthenticates with a Google identity linked to the same account', async () => {
    const context = createContext();
    context.firebaseVerifier.verify.mockResolvedValue({
      email: null,
      provider: 'google',
      subject: 'google-subject',
    });
    context.accountIdentities.findAccountIdForIdentity.mockResolvedValue(
      accountPrincipal.id,
    );

    await expect(
      context.service.withFirebaseIdToken(
        accountPrincipal,
        'valid-google-id-token',
      ),
    ).resolves.toEqual({
      ...tokenPair,
      accountId: accountPrincipal.id,
      provider: 'google',
    });
  });

  it('reauthenticates with an email identity linked to the same account', async () => {
    const context = createContext();
    context.emailOtp.verifyForReauthentication.mockResolvedValue({
      accountId: accountPrincipal.id,
      kind: 'verified',
    });

    await expect(
      context.service.withEmailOtp(
        accountPrincipal,
        'player@example.com',
        '123456',
      ),
    ).resolves.toEqual({
      ...tokenPair,
      accountId: accountPrincipal.id,
      provider: 'email',
    });
    expect(context.sessions.issueForAccount).toHaveBeenCalledWith(
      accountPrincipal.id,
    );
  });

  it('rejects an identity linked to a different account without adopting it', async () => {
    const context = createContext();
    context.firebaseVerifier.verify.mockResolvedValue({
      email: null,
      provider: 'apple',
      subject: 'other-apple-subject',
    });
    context.accountIdentities.findAccountIdForIdentity.mockResolvedValue(
      'account-other',
    );

    await expect(
      context.service.withFirebaseIdToken(
        accountPrincipal,
        'different-account-token',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(context.sessions.issueForAccount).not.toHaveBeenCalled();
    expect(context.accountIdentities.createOrOpen).not.toHaveBeenCalled();
    expect(context.accountIdentities.link).not.toHaveBeenCalled();
  });

  it('rejects an email identity linked to a different account', async () => {
    const context = createContext();
    context.emailOtp.verifyForReauthentication.mockResolvedValue({
      accountId: 'account-other',
      kind: 'verified',
    });

    await expect(
      context.service.withEmailOtp(
        accountPrincipal,
        'someone-else@example.com',
        '123456',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(context.sessions.issueForAccount).not.toHaveBeenCalled();
  });

  it('rejects an identity that resolves to no account', async () => {
    const context = createContext();
    context.firebaseVerifier.verify.mockResolvedValue({
      email: null,
      provider: 'google',
      subject: 'unlinked-google-subject',
    });
    context.accountIdentities.findAccountIdForIdentity.mockResolvedValue(null);

    await expect(
      context.service.withFirebaseIdToken(
        accountPrincipal,
        'unlinked-identity-token',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(context.sessions.issueForAccount).not.toHaveBeenCalled();
  });

  it('rejects a Firebase provider verification failure', async () => {
    const context = createContext();
    context.firebaseVerifier.verify.mockRejectedValue(
      new Error('Provider rejected token'),
    );

    await expect(
      context.service.withFirebaseIdToken(
        accountPrincipal,
        'rejected-firebase-token',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(context.sessions.issueForAccount).not.toHaveBeenCalled();
  });

  it('rejects an invalid email verification code', async () => {
    const context = createContext();
    context.emailOtp.verifyForReauthentication.mockResolvedValue({
      kind: 'invalid-code',
    });

    await expect(
      context.service.withEmailOtp(
        accountPrincipal,
        'player@example.com',
        '654321',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(context.sessions.issueForAccount).not.toHaveBeenCalled();
  });

  it('rejects a Guest principal before touching the provider', async () => {
    const context = createContext();

    await expect(
      context.service.withFirebaseIdToken(
        guestPrincipal,
        'guest-firebase-token',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(context.firebaseVerifier.verify).not.toHaveBeenCalled();
    expect(context.sessions.issueForAccount).not.toHaveBeenCalled();
  });
});
