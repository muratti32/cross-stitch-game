import { AccountIdentityService } from './account-identity.service';
import { AuthSessionService } from './auth-session.service';
import type { FirebaseIdentityVerifier } from './firebase-identity-verifier';
import { FirebaseAuthService } from './firebase-auth.service';
import type { CommercePromotionService } from '../promotion/commerce-promotion.service';

describe('FirebaseAuthService', () => {
  it('exchanges a verified provider identity for a game-owned session', async () => {
    const verifier = {
      verify: jest.fn().mockResolvedValue({
        email: 'person@example.test',
        provider: 'apple',
        subject: 'apple-provider-subject',
      }),
    } as unknown as FirebaseIdentityVerifier;
    const accountIdentities = {
      createOrOpen: jest
        .fn()
        .mockResolvedValue('d98ea632-d326-48ee-bbeb-f9654f7a7759'),
    } as unknown as AccountIdentityService;
    const sessions = {
      issueForAccount: jest.fn().mockResolvedValue({
        accessToken: 'game-access-token',
        refreshToken: 'game-refresh-token',
      }),
    } as unknown as AuthSessionService;
    const commercePromotion = {
      start: jest.fn(),
    } as unknown as CommercePromotionService;
    const service = new FirebaseAuthService(
      verifier,
      accountIdentities,
      sessions,
      commercePromotion,
    );

    await expect(service.exchange('firebase-id-token')).resolves.toEqual({
      accessToken: 'game-access-token',
      accountId: 'd98ea632-d326-48ee-bbeb-f9654f7a7759',
      email: 'person@example.test',
      provider: 'apple',
      refreshToken: 'game-refresh-token',
    });
    expect(accountIdentities.createOrOpen).toHaveBeenCalledWith({
      email: 'person@example.test',
      provider: 'apple',
      subject: 'apple-provider-subject',
    });
  });
});
