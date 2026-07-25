import { GoneException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AppConfigService } from '../config/app-config.service';
import { ACCESS_TOKEN_VERSION } from './auth.constants';
import { AuthHashingService } from './auth-hashing.service';
import { AuthSessionService } from './auth-session.service';
import { AccessTokenPayload } from './auth.types';
import { PrincipalType } from './entities';
import {
  RefreshRotationOutcome,
  RefreshTokenPrincipal,
  RefreshTokensRepository,
} from './refresh-tokens.repository';
import { InvalidatedNamespaceTokenService } from '../deletion/invalidated-namespace-token.service';

describe('AuthSessionService', () => {
  const guestId = '8393f580-9cde-4e2b-bc5d-d77b9fbd73b1';
  let createFamily: jest.Mock<
    Promise<boolean>,
    [PrincipalType, string, string, string, Date]
  >;
  let findPrincipalByTokenHash: jest.Mock<
    Promise<RefreshTokenPrincipal | null>,
    [string]
  >;
  let getFamilyAuthTime: jest.Mock<
    Promise<number | null>,
    [string]
  >;
  let revokeFamilyByTokenHash: jest.Mock<Promise<void>, [string]>;
  let rotate: jest.Mock<
    Promise<RefreshRotationOutcome>,
    [string, string, Date]
  >;
  let signAsync: jest.Mock<Promise<string>, [AccessTokenPayload]>;
  let isInvalidatedMock: jest.Mock<Promise<boolean>, [string]>;
  let hashing: AuthHashingService;
  let service: AuthSessionService;

  beforeEach(() => {
    createFamily = jest.fn<
      Promise<boolean>,
      [PrincipalType, string, string, string, Date]
    >().mockResolvedValue(true);
    findPrincipalByTokenHash = jest
      .fn<Promise<RefreshTokenPrincipal | null>, [string]>()
      .mockResolvedValue({
        principalId: guestId,
        principalType: PrincipalType.Guest,
      });
    getFamilyAuthTime = jest
      .fn<Promise<number | null>, [string]>()
      .mockResolvedValue(1783987200);
    revokeFamilyByTokenHash = jest
      .fn<Promise<void>, [string]>()
      .mockResolvedValue();
    rotate = jest.fn<
      Promise<RefreshRotationOutcome>,
      [string, string, Date]
    >();
    signAsync = jest
      .fn<Promise<string>, [AccessTokenPayload]>()
      .mockResolvedValue('signed-access-token');

    isInvalidatedMock = jest
      .fn<Promise<boolean>, [string]>()
      .mockResolvedValue(false);

    const config = {
      refreshTokenTtlSeconds: 3_600,
    } as unknown as AppConfigService;
    const jwtService = { signAsync } as unknown as JwtService;
    const repository = {
      createFamily,
      findPrincipalByTokenHash,
      getFamilyAuthTime,
      revokeFamilyByTokenHash,
      rotate,
    } as unknown as RefreshTokensRepository;
    const invalidatedTokens = {
      isInvalidated: isInvalidatedMock,
    } as unknown as InvalidatedNamespaceTokenService;

    hashing = new AuthHashingService();
    service = new AuthSessionService(
      config,
      hashing,
      jwtService,
      repository,
      invalidatedTokens,
    );
  });

  it('creates a guest refresh family and signs the minimal access claims', async () => {
    const tokens = await service.issueForGuest(guestId);

    expect(tokens.accessToken).toBe('signed-access-token');
    expect(tokens.refreshToken).toHaveLength(43);
    expect(createFamily).toHaveBeenCalledWith(
      PrincipalType.Guest,
      guestId,
      hashing.hashOpaqueToken(tokens.refreshToken),
      expect.any(String),
      expect.any(Date),
    );
    const signedPayload = signAsync.mock.calls[0]?.[0];
    if (signedPayload === undefined) {
      throw new Error('Access JWT was not signed');
    }
    expect(signedPayload).toMatchObject({
      principalType: PrincipalType.Guest,
      sub: guestId,
      tokenVersion: ACCESS_TOKEN_VERSION,
    });
    expect(signedPayload.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('returns a new opaque token after a successful guarded rotation', async () => {
    rotate.mockResolvedValue({
      kind: 'rotated',
      principalId: guestId,
      principalType: PrincipalType.Guest,
    });

    const tokens = await service.refresh('original-refresh-token-value-123456');
    const rotationCall = rotate.mock.calls[0];
    if (rotationCall === undefined) {
      throw new Error('Refresh rotation was not called');
    }

    expect(rotationCall[0]).toBe(
      hashing.hashOpaqueToken('original-refresh-token-value-123456'),
    );
    expect(rotationCall[1]).toBe(
      hashing.hashOpaqueToken(tokens.refreshToken),
    );
    expect(tokens.refreshToken).not.toBe(
      'original-refresh-token-value-123456',
    );
    expect(tokens.accessToken).toBe('signed-access-token');
  });

  it('does not return a signed session when the guest is no longer active', async () => {
    createFamily.mockResolvedValue(false);

    await expect(service.issueForGuest(guestId)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([
    { kind: 'invalid' },
    { kind: 'reuse-detected' },
  ] as const)(
    'rejects the $kind rotation outcome without returning session data',
    async (outcome) => {
      rotate.mockResolvedValue(outcome);

      await expect(
        service.refresh('rejected-refresh-token-value-12345'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(signAsync).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects an unknown refresh token before signing or rotating', async () => {
    findPrincipalByTokenHash.mockResolvedValue(null);

    await expect(
      service.refresh('unknown-refresh-token-value-123456'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(signAsync).not.toHaveBeenCalled();
    expect(rotate).not.toHaveBeenCalled();
  });

  it('an unknown refresh token that matches an invalidated-namespace marker yields GoneException', async () => {
    findPrincipalByTokenHash.mockResolvedValue(null);
    isInvalidatedMock.mockResolvedValue(true);

    await expect(
      service.refresh('invalidated-refresh-token'),
    ).rejects.toThrow(GoneException);

    const thrown = await service
      .refresh('invalidated-refresh-token')
      .then(() => null)
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(GoneException);
    expect((thrown as GoneException).getResponse()).toEqual({
      code: 'ACCOUNT_DELETED',
      message: 'Account has been deleted',
    });
  });

  it('hashes the presented token before idempotent family logout', async () => {
    const refreshToken = 'logout-refresh-token-value-123456789';

    await service.logout(refreshToken);

    expect(revokeFamilyByTokenHash).toHaveBeenCalledWith(
      hashing.hashOpaqueToken(refreshToken),
    );
  });
});
