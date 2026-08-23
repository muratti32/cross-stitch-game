import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { configureApi } from '../src/api/configure-api';
import { ACCESS_TOKEN_VERSION } from '../src/auth/auth.constants';
import { AppConfigService } from '../src/config/app-config.service';
import { EmailOutboxDispatcherService } from '../src/auth/email-outbox-dispatcher.service';
import { EMAIL_SENDER } from '../src/auth/email-sender.interface';
import {
  AuthIdentityEntity,
  PrincipalType,
  RefreshTokenEntity,
  RefreshTokenStatus,
} from '../src/auth/entities';
import { FIREBASE_IDENTITY_VERIFIER } from '../src/auth/firebase-identity-verifier';
import { LocalEmailSender } from '../src/auth/local-email-sender';
import { LocalObjectStorage } from '../src/catalog/storage/local-object-storage';
import { OBJECT_STORAGE } from '../src/catalog/storage/object-storage.interface';

/**
 * Deletion reauthentication is only safe if identity ownership, the account
 * closure transition, and refresh-family revocation really hold. Those are
 * database constraints and transactions, not object state, so this suite drives
 * the whole path over the HTTP API against a real PostgreSQL: an Auth Identity
 * owned by another account must stay owned by it, an unknown identity must not
 * be created, and a granted Account Deletion Request must leave no usable
 * session family behind.
 */
describe('Account Deletion Request reauthentication', () => {
  // The link and reauthenticate endpoints both require a JWT-shaped provider
  // token, so the stand-in tokens carry a real header/payload and a distinct
  // trailing segment the fake verifier switches on.
  const PROVIDER_TOKEN_PREFIX =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.';
  const APPLE_TOKEN_A = `${PROVIDER_TOKEN_PREFIX}appleA`;
  const GOOGLE_TOKEN_A = `${PROVIDER_TOKEN_PREFIX}googleA`;
  const GOOGLE_TOKEN_B = `${PROVIDER_TOKEN_PREFIX}googleB`;
  const INVALID_PROVIDER_TOKEN = `${PROVIDER_TOKEN_PREFIX}rejected`;
  const UNLINKED_APPLE_TOKEN = `${PROVIDER_TOKEN_PREFIX}appleUnlinked`;

  const APPLE_SUBJECT_A = `apple-a-${randomUUID()}`;
  const GOOGLE_SUBJECT_A = `google-a-${randomUUID()}`;
  const GOOGLE_SUBJECT_B = `google-b-${randomUUID()}`;
  const UNLINKED_APPLE_SUBJECT = `apple-unlinked-${randomUUID()}`;

  const EMAIL_A = `reauth-a-${randomUUID()}@example.test`;
  const EMAIL_B = `reauth-b-${randomUUID()}@example.test`;

  let app: INestApplication;
  let httpServer: Server;
  let dataSource: DataSource;
  let emailDispatcher: EmailOutboxDispatcherService;
  let localEmailSender: LocalEmailSender;
  let accountIdA = '';
  let accessTokenA = '';
  let refreshTokenA = '';
  let staleTokenA = '';

  async function dispatchAndReadEmailOtp(email: string): Promise<string> {
    let rounds = 0;
    const maxRounds = 20;
    while (rounds < maxRounds) {
      rounds++;
      const dispatchedCount = await emailDispatcher.dispatchOnce();
      const delivery = localEmailSender
        .getDeliveries()
        .slice()
        .reverse()
        .find((candidate) => candidate.toEmail === email);
      if (delivery !== undefined) {
        return delivery.code;
      }
      if (dispatchedCount === 0) {
        break;
      }
    }
    throw new Error(
      `Email OTP delivery was not recorded after ${rounds} dispatch rounds`,
    );
  }

  interface AccountSession {
    accessToken: string;
    accountId: string;
    refreshToken: string;
  }

  async function createEmailAccount(email: string): Promise<AccountSession> {
    await request(httpServer)
      .post('/v1/auth/email/request')
      .send({ email })
      .expect(202)
      .expect({ status: 'sent' });

    const code = await dispatchAndReadEmailOtp(email);
    const response = await request(httpServer)
      .post('/v1/auth/email/verify')
      .send({ code, email })
      .expect(200);

    return {
      accessToken: readString(response.body, 'accessToken'),
      accountId: readString(response.body, 'accountId'),
      refreshToken: readString(response.body, 'refreshToken'),
    };
  }

  /**
   * Mints a player access token with a chosen `authTime`. The token is signed
   * from the player JWT secret directly: resolving Nest's JwtService from the
   * running application yields the operator console's instance, whose different
   * secret, audience, and issuer the player guard rejects outright.
   */
  function mintAccountToken(accountId: string, authTime: number): string {
    const config = app.get(AppConfigService);
    return sign(
      {
        authTime,
        jti: randomUUID(),
        principalType: PrincipalType.Account,
        sub: accountId,
        tokenVersion: ACCESS_TOKEN_VERSION,
      },
      config.jwtSecret,
      { algorithm: 'HS256', expiresIn: config.jwtAccessTtlSeconds },
    );
  }

  beforeAll(async () => {
    const { ApiAppModule } = await import('../src/app.api.module');
    // The overrides pin the offline email sender and object storage, and stand
    // in for Firebase so provider verification is deterministic.
    const moduleRef = await Test.createTestingModule({ imports: [ApiAppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useFactory({
        factory: (local: LocalEmailSender) => local,
        inject: [LocalEmailSender],
      })
      .overrideProvider(OBJECT_STORAGE)
      .useFactory({
        factory: (local: LocalObjectStorage) => local,
        inject: [LocalObjectStorage],
      })
      .overrideProvider(FIREBASE_IDENTITY_VERIFIER)
      .useValue({
        verify: jest.fn((idToken: string) => {
          switch (idToken) {
            case APPLE_TOKEN_A:
              return Promise.resolve({
                email: EMAIL_A,
                provider: 'apple',
                subject: APPLE_SUBJECT_A,
              });
            case GOOGLE_TOKEN_A:
              return Promise.resolve({
                email: EMAIL_A,
                provider: 'google',
                subject: GOOGLE_SUBJECT_A,
              });
            case GOOGLE_TOKEN_B:
              return Promise.resolve({
                email: EMAIL_B,
                provider: 'google',
                subject: GOOGLE_SUBJECT_B,
              });
            case UNLINKED_APPLE_TOKEN:
              return Promise.resolve({
                email: null,
                provider: 'apple',
                subject: UNLINKED_APPLE_SUBJECT,
              });
            default:
              return Promise.reject(new Error('Provider rejected token'));
          }
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApi(app);
    await app.init();

    httpServer = app.getHttpServer() as Server;
    dataSource = app.get(DataSource);
    emailDispatcher = app.get(EmailOutboxDispatcherService);
    localEmailSender = app.get(LocalEmailSender);

    const accountA = await createEmailAccount(EMAIL_A);
    accountIdA = accountA.accountId;
    accessTokenA = accountA.accessToken;
    refreshTokenA = accountA.refreshToken;

    staleTokenA = mintAccountToken(
      accountIdA,
      Math.floor(Date.now() / 1000) - 600,
    );
  });

  afterAll(async () => {
    if (app !== undefined) {
      await app.close();
    }
  });

  it('reports no deletion request for a normal active account', async () => {
    await request(httpServer)
      .get('/v1/account/deletion')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .expect(200)
      .expect({ status: 'none' });
  });

  it('blocks a deletion request when authentication is no longer recent', async () => {
    await request(httpServer)
      .post('/v1/account/deletion')
      .set('Authorization', `Bearer ${staleTokenA}`)
      .send({ confirmation: 'DELETE' })
      .expect(401);
  });

  it('accepts every linked provider as proof of recent same-account authentication', async () => {
    await request(httpServer)
      .post('/v1/auth/identities/link/firebase')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ idToken: APPLE_TOKEN_A })
      .expect(204);

    await request(httpServer)
      .post('/v1/auth/identities/link/firebase')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ idToken: GOOGLE_TOKEN_A })
      .expect(204);

    let previousAccessToken = accessTokenA;
    let previousRefreshToken = refreshTokenA;

    await request(httpServer)
      .post('/v1/auth/email/request')
      .send({ email: EMAIL_A })
      .expect(202)
      .expect({ status: 'sent' });

    const emailCode = await dispatchAndReadEmailOtp(EMAIL_A);
    const emailResponse = await request(httpServer)
      .post('/v1/account/reauthenticate/email')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ code: emailCode, email: EMAIL_A })
      .expect(200);

    const emailAccessToken = readString(emailResponse.body, 'accessToken');
    const emailRefreshToken = readString(emailResponse.body, 'refreshToken');
    expect(readString(emailResponse.body, 'accountId')).toBe(accountIdA);
    expect(readString(emailResponse.body, 'provider')).toBe('email');
    expect(emailAccessToken.length).toBeGreaterThan(0);
    expect(emailRefreshToken.length).toBeGreaterThan(0);
    expect(emailAccessToken).not.toBe(previousAccessToken);
    expect(emailRefreshToken).not.toBe(previousRefreshToken);

    previousAccessToken = emailAccessToken;
    previousRefreshToken = emailRefreshToken;

    const appleResponse = await request(httpServer)
      .post('/v1/account/reauthenticate/firebase')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ idToken: APPLE_TOKEN_A })
      .expect(200);

    const appleAccessToken = readString(appleResponse.body, 'accessToken');
    const appleRefreshToken = readString(appleResponse.body, 'refreshToken');
    expect(readString(appleResponse.body, 'accountId')).toBe(accountIdA);
    expect(readString(appleResponse.body, 'provider')).toBe('apple');
    expect(appleAccessToken.length).toBeGreaterThan(0);
    expect(appleRefreshToken.length).toBeGreaterThan(0);
    expect(appleRefreshToken).not.toBe(previousRefreshToken);

    previousRefreshToken = appleRefreshToken;

    const googleResponse = await request(httpServer)
      .post('/v1/account/reauthenticate/firebase')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ idToken: GOOGLE_TOKEN_A })
      .expect(200);

    const googleAccessToken = readString(googleResponse.body, 'accessToken');
    const googleRefreshToken = readString(googleResponse.body, 'refreshToken');
    expect(readString(googleResponse.body, 'accountId')).toBe(accountIdA);
    expect(readString(googleResponse.body, 'provider')).toBe('google');
    expect(googleAccessToken.length).toBeGreaterThan(0);
    expect(googleRefreshToken).not.toBe(previousRefreshToken);
  });

  it('rejects a provider identity owned by a different account without moving it', async () => {
    const accountB = await createEmailAccount(EMAIL_B);

    await request(httpServer)
      .post('/v1/auth/identities/link/firebase')
      .set('Authorization', `Bearer ${accountB.accessToken}`)
      .send({ idToken: GOOGLE_TOKEN_B })
      .expect(204);

    const response = await request(httpServer)
      .post('/v1/account/reauthenticate/firebase')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ idToken: GOOGLE_TOKEN_B })
      .expect(403);

    expect(readString(response.body, 'reason')).toBe('different_account');

    const identityRepository = dataSource.getRepository(AuthIdentityEntity);
    const googleBIdentity = await identityRepository.findOneBy({
      subject: GOOGLE_SUBJECT_B,
    });
    expect(googleBIdentity).not.toBeNull();
    expect(googleBIdentity?.accountId).toBe(accountB.accountId);

    const adoptedCount = await identityRepository.countBy({
      accountId: accountIdA,
      subject: GOOGLE_SUBJECT_B,
    });
    expect(adoptedCount).toBe(0);
  });

  it('rejects an unlinked provider identity without creating or adopting it', async () => {
    const response = await request(httpServer)
      .post('/v1/account/reauthenticate/firebase')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ idToken: UNLINKED_APPLE_TOKEN })
      .expect(403);

    expect(readString(response.body, 'reason')).toBe('different_account');

    const identity = await dataSource
      .getRepository(AuthIdentityEntity)
      .findOneBy({ subject: UNLINKED_APPLE_SUBJECT });
    expect(identity).toBeNull();
  });

  it('returns an actionable provider rejection that never reads as success', async () => {
    const response = await request(httpServer)
      .post('/v1/account/reauthenticate/firebase')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ idToken: INVALID_PROVIDER_TOKEN })
      .expect(401);

    expect(readString(response.body, 'reason')).toBe('provider_rejected');
    const message = readString(response.body, 'message');
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain('401');
  });

  it('rejects an incorrect email verification code', async () => {
    await request(httpServer)
      .post('/v1/auth/email/request')
      .send({ email: EMAIL_A })
      .expect(202)
      .expect({ status: 'sent' });

    const realCode = await dispatchAndReadEmailOtp(EMAIL_A);
    const wrongCode = realCode === '000000' ? '111111' : '000000';

    const response = await request(httpServer)
      .post('/v1/account/reauthenticate/email')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ code: wrongCode, email: EMAIL_A })
      .expect(401);

    expect(readString(response.body, 'reason')).toBe('provider_rejected');
  });

  it('prevents a Guest Player from reauthenticating for account deletion', async () => {
    const guestResponse = await request(httpServer)
      .post('/v1/auth/guest')
      .send({
        credentialSecret: randomBytes(32).toString('base64url'),
        installationKey: randomUUID(),
      })
      .expect(201);

    const guestAccessToken = readString(guestResponse.body, 'accessToken');

    await request(httpServer)
      .post('/v1/account/reauthenticate/firebase')
      .set('Authorization', `Bearer ${guestAccessToken}`)
      .send({ idToken: APPLE_TOKEN_A })
      .expect(403);
  });

  it('resumes the interrupted deletion request after reauthentication and revokes every session family', async () => {
    const reauthenticated = await request(httpServer)
      .post('/v1/account/reauthenticate/firebase')
      .set('Authorization', `Bearer ${staleTokenA}`)
      .send({ idToken: APPLE_TOKEN_A })
      .expect(200);

    expect(readString(reauthenticated.body, 'accountId')).toBe(accountIdA);
    const resumedAccessToken = readString(reauthenticated.body, 'accessToken');

    const deletionResponse = await request(httpServer)
      .post('/v1/account/deletion')
      .set('Authorization', `Bearer ${resumedAccessToken}`)
      .send({ confirmation: 'DELETE' })
      .expect(200);

    expect(readString(deletionResponse.body, 'status')).toBe('pending');

    const recoveryWindowEndsAt = new Date(
      readString(deletionResponse.body, 'recoveryWindowEndsAt'),
    );
    expect(Number.isNaN(recoveryWindowEndsAt.getTime())).toBe(false);
    const daysUntilRecoveryEnds =
      (recoveryWindowEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysUntilRecoveryEnds).toBeGreaterThanOrEqual(29);
    expect(daysUntilRecoveryEnds).toBeLessThanOrEqual(31);

    // Every session family is revoked by the request, so a further read needs a
    // separately minted token rather than a refresh.
    const inspectionToken = mintAccountToken(
      accountIdA,
      Math.floor(Date.now() / 1000),
    );
    const statusResponse = await request(httpServer)
      .get('/v1/account/deletion')
      .set('Authorization', `Bearer ${inspectionToken}`)
      .expect(200);
    expect(readString(statusResponse.body, 'status')).toBe('pending');

    const refreshTokens = await dataSource
      .getRepository(RefreshTokenEntity)
      .findBy({ principalId: accountIdA, principalType: PrincipalType.Account });
    expect(refreshTokens.length).toBeGreaterThan(0);
    expect(
      refreshTokens.every(
        (token) => token.status === RefreshTokenStatus.Revoked,
      ),
    ).toBe(true);
  });

  it('restores the account when the deletion request is cancelled', async () => {
    const cancellationToken = mintAccountToken(
      accountIdA,
      Math.floor(Date.now() / 1000),
    );

    await request(httpServer)
      .post('/v1/account/deletion/cancel')
      .set('Authorization', `Bearer ${cancellationToken}`)
      .expect(200)
      .expect({ status: 'none' });

    const rows: readonly { status: string }[] = await dataSource.query(
      'SELECT status FROM auth.registered_accounts WHERE id = $1',
      [accountIdA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('active');
  });
});

function readString(body: unknown, key: string): string {
  const value = (body as Record<string, unknown>)[key];
  if (typeof value !== 'string') {
    throw new TypeError(`Expected ${key} to be a string`);
  }
  return value;
}
