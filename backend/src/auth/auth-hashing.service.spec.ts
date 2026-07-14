import { AuthHashingService } from './auth-hashing.service';

describe('AuthHashingService', () => {
  const service = new AuthHashingService();

  it('hashes opaque tokens with deterministic SHA-256', () => {
    expect(service.hashOpaqueToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(service.hashOpaqueToken('abc')).not.toBe(
      service.hashOpaqueToken('different-token'),
    );
  });

  it('normalizes UUID casing before hashing an installation key', () => {
    expect(
      service.hashInstallationKey(
        'A8098C1A-F86E-11DA-BD1A-00112444BE1E',
      ),
    ).toBe(
      service.hashInstallationKey(
        'a8098c1a-f86e-11da-bd1a-00112444be1e',
      ),
    );
  });

  it('generates independent high-entropy opaque refresh tokens', () => {
    const first = service.generateOpaqueRefreshToken();
    const second = service.generateOpaqueRefreshToken();

    expect(first).toHaveLength(43);
    expect(second).toHaveLength(43);
    expect(first).not.toBe(second);
  });

  it('bcrypt-hashes credential secrets and verifies only the original', async () => {
    const credentialSecret = 'correct-high-entropy-credential-secret';
    const credentialHash =
      await service.hashCredentialSecret(credentialSecret);

    expect(credentialHash).not.toContain(credentialSecret);
    await expect(
      service.verifyCredentialSecret(credentialSecret, credentialHash),
    ).resolves.toBe(true);
    await expect(
      service.verifyCredentialSecret(
        'wrong-high-entropy-credential-secret-1',
        credentialHash,
      ),
    ).resolves.toBe(false);
  });
});
