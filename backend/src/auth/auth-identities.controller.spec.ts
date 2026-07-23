import { UnauthorizedException } from '@nestjs/common';
import { AuthIdentitiesController } from './auth-identities.controller';
import { AccountIdentityService } from './account-identity.service';
import { EmailOtpService } from './email-otp.service';
import { FirebaseIdentityVerifier } from './firebase-identity-verifier';
import { AuthPrincipal } from './auth.types';
import { PrincipalType } from './entities';

describe('AuthIdentitiesController', () => {
  let controller: AuthIdentitiesController;
  let accountIdentities: jest.Mocked<AccountIdentityService>;
  let emailOtp: jest.Mocked<EmailOtpService>;
  let firebaseVerifier: jest.Mocked<FirebaseIdentityVerifier>;

  beforeEach(() => {
    accountIdentities = {
      link: jest.fn(),
      unlink: jest.fn(),
    } as unknown as jest.Mocked<AccountIdentityService>;

    emailOtp = {
      verifyAndLink: jest.fn(),
    } as unknown as jest.Mocked<EmailOtpService>;

    firebaseVerifier = {
      verify: jest.fn(),
    };

    controller = new AuthIdentitiesController(
      accountIdentities,
      emailOtp,
      firebaseVerifier,
    );
  });

  const validPrincipal: AuthPrincipal = {
    id: 'account-uuid',
    tokenVersion: 1,
    type: PrincipalType.Account,
    authTime: Math.floor(Date.now() / 1000) - 10, // 10 seconds ago (recent)
  };

  const expiredPrincipal: AuthPrincipal = {
    id: 'account-uuid',
    tokenVersion: 1,
    type: PrincipalType.Account,
    authTime: Math.floor(Date.now() / 1000) - 310, // 5 min 10 sec ago (expired)
  };

  const guestPrincipal: AuthPrincipal = {
    id: 'guest-uuid',
    tokenVersion: 1,
    type: PrincipalType.Guest,
    authTime: Math.floor(Date.now() / 1000),
  };

  describe('linkFirebase', () => {
    it('successfully links a firebase identity with a recent reauth', async () => {
      firebaseVerifier.verify.mockResolvedValue({
        email: 'test@example.com',
        provider: 'google',
        subject: 'google-sub-123',
      });

      await expect(
        controller.linkFirebase(validPrincipal, { idToken: 'valid-token' }),
      ).resolves.not.toThrow();

      expect(firebaseVerifier.verify).toHaveBeenCalledWith('valid-token');
      expect(accountIdentities.link).toHaveBeenCalledWith('account-uuid', {
        email: 'test@example.com',
        provider: 'google',
        subject: 'google-sub-123',
      });
    });

    it('rejects if principal is not an account', async () => {
      await expect(
        controller.linkFirebase(guestPrincipal, { idToken: 'valid-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects if reauth is not recent', async () => {
      await expect(
        controller.linkFirebase(expiredPrincipal, { idToken: 'valid-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('linkEmail', () => {
    it('successfully links an email with a recent reauth', async () => {
      await expect(
        controller.linkEmail(validPrincipal, {
          email: 'test@example.com',
          code: '123456',
        }),
      ).resolves.not.toThrow();

      expect(emailOtp.verifyAndLink).toHaveBeenCalledWith(
        'account-uuid',
        'test@example.com',
        '123456',
      );
    });

    it('rejects if principal is not an account', async () => {
      await expect(
        controller.linkEmail(guestPrincipal, {
          email: 'test@example.com',
          code: '123456',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects if reauth is not recent', async () => {
      await expect(
        controller.linkEmail(expiredPrincipal, {
          email: 'test@example.com',
          code: '123456',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('unlink', () => {
    it('successfully unlinks an identity with a recent reauth', async () => {
      await expect(
        controller.unlink(validPrincipal, {
          provider: 'google',
          subject: 'google-sub-123',
        }),
      ).resolves.not.toThrow();

      expect(accountIdentities.unlink).toHaveBeenCalledWith(
        'account-uuid',
        'google',
        'google-sub-123',
      );
    });

    it('rejects if principal is not an account', async () => {
      await expect(
        controller.unlink(guestPrincipal, {
          provider: 'google',
          subject: 'google-sub-123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects if reauth is not recent', async () => {
      await expect(
        controller.unlink(expiredPrincipal, {
          provider: 'google',
          subject: 'google-sub-123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
