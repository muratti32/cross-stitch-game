import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { configureApi } from '../src/api/configure-api';
import { EmailOutboxDispatcherService } from '../src/auth/email-outbox-dispatcher.service';
import { EMAIL_SENDER } from '../src/auth/email-sender.interface';
import {
  FIREBASE_IDENTITY_VERIFIER,
  FirebaseProviderIdentity,
} from '../src/auth/firebase-identity-verifier';
import { LocalEmailSender } from '../src/auth/local-email-sender';
import { LocalObjectStorage } from '../src/catalog/storage/local-object-storage';
import { OBJECT_STORAGE } from '../src/catalog/storage/object-storage.interface';

describe('Account deletion reauthentication', () => {
  interface AccountSession {
    accessToken: string;
    accountId: string;
    email: string;
    refreshToken: string;
  }

  interface GuestSession {
    accessToken: string;
  }

  interface LinkedIdentityView {
    email: string | null;
    provider: string;
  }

  let app: INestApplication;
  let httpServer: Server;
  let dataSource: DataSource;
  let emailDispatcher: EmailOutboxDispatcherService;
  let localEmailSender: LocalEmailSender;

  const firebaseIdentities = new Map<string, FirebaseProviderIdentity>();

  beforeAll(async () => {
    const { ApiAppModule } = await import('../src/app.api.module');
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
        verify: jest.fn((idToken: string): Promise<FirebaseProviderIdentity> => {
          const identity = firebaseIdentities.get(idToken);
          return identity === undefined
            ? Promise.reject(new Error('Invalid Firebase token'))
            : Promise.resolve(identity);
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
  });

  afterAll(async () => {
    if (app !== undefined) await app.close();
  });

  function authHeaders(accessToken: string): { Authorization: string } {
    return { Authorization: `Bearer ${accessToken}` };
  }

  function readRecord(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError(`Expected ${label} to be an object`);
    }
    return value as Record<string, unknown>;
  }

  function readField(body: unknown, key: string): unknown {
    return readRecord(body, 'response body')[key];
  }

  function readString(body: unknown, key: string): string {
    const value = readField(body, key);
    if (typeof value !== 'string') {
      throw new TypeError(`Expected ${key} to be a string`);
    }
    return value;
  }

  function readNullableString(body: unknown, key: string): string | null {
    const value = readField(body, key);
    if (value !== null && typeof value !== 'string') {
      throw new TypeError(`Expected ${key} to be a string or null`);
    }
    return value;
  }

  function readIdentities(body: unknown): readonly LinkedIdentityView[] {
    const value = readField(body, 'identities');
    if (!Array.isArray(value)) {
      throw new TypeError('Expected identities to be an array');
    }
    return value.map((candidate) => ({
      email: readNullableString(candidate, 'email'),
      provider: readString(candidate, 'provider'),
    }));
  }

  async function requestEmailCode(email: string): Promise<string> {
    await request(httpServer)
      .post('/v1/auth/email/request')
      .send({ email })
      .expect(202);

    // A second code for the same address must not resolve to the delivery that
    // the first request already produced, so only deliveries appended after this
    // request count.
    const alreadyDelivered = localEmailSender
      .getDeliveries()
      .filter((candidate) => candidate.toEmail === email).length;

    for (let round = 0; round < 20; round++) {
      await emailDispatcher.dispatchOnce();
      const deliveries = localEmailSender
        .getDeliveries()
        .filter((candidate) => candidate.toEmail === email);
      if (deliveries.length > alreadyDelivered) {
        return deliveries[deliveries.length - 1].code;
      }
    }
    throw new Error(`No email OTP was delivered for ${email}`);
  }

  async function newAccount(): Promise<AccountSession> {
    const email = `deletion-reauth-${randomUUID()}@example.test`;
    const code = await requestEmailCode(email);
    const response = await request(httpServer)
      .post('/v1/auth/email/verify')
      .send({ code, email })
      .expect(200);
    return {
      accessToken: readString(response.body, 'accessToken'),
      accountId: readString(response.body, 'accountId'),
      email,
      refreshToken: readString(response.body, 'refreshToken'),
    };
  }

  async function newGuest(): Promise<GuestSession> {
    const response = await request(httpServer)
      .post('/v1/auth/guest')
      .send({
        credentialSecret: randomBytes(32).toString('base64url'),
        installationKey: randomUUID(),
      })
      .expect(201);
    return { accessToken: readString(response.body, 'accessToken') };
  }

  // The link and reauthenticate DTOs both require a JWT-shaped credential, so
  // the fake provider tokens must carry three base64url segments even though the
  // overridden verifier only ever looks them up by string.
  function fakeIdToken(): string {
    const segment = (value: string): string =>
      Buffer.from(value).toString('base64url');
    return [
      segment('{"alg":"RS256","typ":"JWT"}'),
      segment(`{"sub":"${randomUUID()}"}`),
      segment(randomUUID()),
    ].join('.');
  }

  function registerFirebaseIdentity(
    provider: 'apple' | 'google',
    email: string | null,
  ): { idToken: string; subject: string } {
    const idToken = fakeIdToken();
    const subject = `${provider}-subject-${randomUUID()}`;
    firebaseIdentities.set(idToken, { email, provider, subject });
    return { idToken, subject };
  }

  async function linkFirebase(
    account: AccountSession,
    provider: 'apple' | 'google',
  ): Promise<{ idToken: string; subject: string }> {
    const identity = registerFirebaseIdentity(provider, account.email);
    await request(httpServer)
      .post('/v1/auth/identities/link/firebase')
      .set(authHeaders(account.accessToken))
      .send({ idToken: identity.idToken })
      .expect(204);
    return identity;
  }

  /**
   * A real session whose recent-auth window has lapsed. `authTime` is derived
   * from the refresh family's first token, so backdating that row and refreshing
   * reproduces what a player sees hours after signing in — no hand-signed token,
   * which would bypass the guard the flow actually runs through.
   */
  async function staleSessionToken(account: AccountSession): Promise<string> {
    await dataSource.query(
      `UPDATE auth.refresh_tokens
       SET created_at = now() - interval '2 hours'
       WHERE principal_id = $1`,
      [account.accountId],
    );
    const response = await request(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken })
      .expect(200);
    return readString(response.body, 'accessToken');
  }

  async function expectDeletionSucceeds(accessToken: string): Promise<void> {
    const response = await request(httpServer)
      .post('/v1/account/deletion')
      .set(authHeaders(accessToken))
      .send({ confirmation: 'DELETE' })
      .expect(200);
    expect(readString(response.body, 'status')).toBe('pending');
  }

  it('accepts a fresh deletion request and reports its 30-day recovery window', async () => {
    const account = await newAccount();
    await expectDeletionSucceeds(account.accessToken);

    const response = await request(httpServer)
      .get('/v1/account/deletion')
      .set(authHeaders(account.accessToken))
      .expect(200);
    expect(readString(response.body, 'status')).toBe('pending');

    const recoveryWindowEndsAt = Date.parse(
      readString(response.body, 'recoveryWindowEndsAt'),
    );
    expect(Number.isNaN(recoveryWindowEndsAt)).toBe(false);
    expect(recoveryWindowEndsAt - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect(recoveryWindowEndsAt - Date.now()).toBeLessThan(31 * 86_400_000);
  });

  it('rejects deletion when the access-token authTime is older than 300 seconds', async () => {
    const account = await newAccount();
    const stale = await staleSessionToken(account);

    // The stale token is still a valid session: only the recent-auth window has
    // lapsed, so status stays readable while the destructive route is refused.
    await request(httpServer)
      .get('/v1/account/deletion')
      .set(authHeaders(stale))
      .expect(200);

    await request(httpServer)
      .post('/v1/account/deletion')
      .set(authHeaders(stale))
      .send({ confirmation: 'DELETE' })
      .expect(401);
  });

  it('lists every linked identity without exposing provider subjects', async () => {
    const account = await newAccount();
    const google = await linkFirebase(account, 'google');

    const response = await request(httpServer)
      .get('/v1/account/reauthenticate/identities')
      .set(authHeaders(account.accessToken))
      .expect(200);
    expect(readIdentities(response.body)).toEqual([
      { email: account.email, provider: 'email' },
      { email: account.email, provider: 'google' },
    ]);
    expect(JSON.stringify(response.body)).not.toContain(google.subject);
    expect(JSON.stringify(response.body)).not.toContain('subject');
  });

  it.each(['email', 'google', 'apple'] as const)(
    'reauthenticates with linked %s and makes deletion recent',
    async (provider) => {
      const account = await newAccount();
      const oldToken = await staleSessionToken(account);
      await request(httpServer)
        .post('/v1/account/deletion')
        .set(authHeaders(oldToken))
        .send({ confirmation: 'DELETE' })
        .expect(401);

      let response;
      if (provider === 'email') {
        const code = await requestEmailCode(account.email);
        response = await request(httpServer)
          .post('/v1/account/reauthenticate/email')
          .set(authHeaders(oldToken))
          .send({ code, email: account.email })
          .expect(200);
      } else {
        const identity = await linkFirebase(account, provider);
        response = await request(httpServer)
          .post('/v1/account/reauthenticate/firebase')
          .set(authHeaders(oldToken))
          .send({ idToken: identity.idToken })
          .expect(200);
      }

      expect(readString(response.body, 'accountId')).toBe(account.accountId);
      expect(readString(response.body, 'provider')).toBe(provider);
      await expectDeletionSucceeds(readString(response.body, 'accessToken'));
    },
  );

  it('rejects a Firebase identity owned by another account without changing ownership or links', async () => {
    const current = await newAccount();
    const other = await newAccount();
    await linkFirebase(current, 'google');
    const otherGoogle = await linkFirebase(other, 'google');

    const beforeResponse = await request(httpServer)
      .get('/v1/account/reauthenticate/identities')
      .set(authHeaders(current.accessToken))
      .expect(200);
    const before = readIdentities(beforeResponse.body);

    await request(httpServer)
      .post('/v1/account/reauthenticate/firebase')
      .set(authHeaders(current.accessToken))
      .send({ idToken: otherGoogle.idToken })
      .expect(403);

    const ownerRows: readonly { accountId: string }[] = await dataSource.query(
      `SELECT account_id AS "accountId"
       FROM auth.auth_identities
       WHERE provider = 'google' AND subject = $1`,
      [otherGoogle.subject],
    );
    expect(ownerRows).toEqual([{ accountId: other.accountId }]);

    const afterResponse = await request(httpServer)
      .get('/v1/account/reauthenticate/identities')
      .set(authHeaders(current.accessToken))
      .expect(200);
    expect(readIdentities(afterResponse.body)).toEqual(before);
  });

  it('rejects a valid OTP for an email not linked to the current account', async () => {
    const current = await newAccount();
    const unlinkedEmail = `unlinked-${randomUUID()}@example.test`;
    const beforeResponse = await request(httpServer)
      .get('/v1/account/reauthenticate/identities')
      .set(authHeaders(current.accessToken))
      .expect(200);
    const before = readIdentities(beforeResponse.body);
    const code = await requestEmailCode(unlinkedEmail);

    await request(httpServer)
      .post('/v1/account/reauthenticate/email')
      .set(authHeaders(current.accessToken))
      .send({ code, email: unlinkedEmail })
      .expect(403);

    const identityRows: readonly { count: string }[] = await dataSource.query(
      `SELECT count(*)::text AS count
       FROM auth.auth_identities
       WHERE provider = 'email' AND subject = $1`,
      [unlinkedEmail],
    );
    expect(identityRows).toEqual([{ count: '0' }]);

    const afterResponse = await request(httpServer)
      .get('/v1/account/reauthenticate/identities')
      .set(authHeaders(current.accessToken))
      .expect(200);
    expect(readIdentities(afterResponse.body)).toEqual(before);
  });

  it('rejects invalid and expired email OTPs with 401', async () => {
    const account = await newAccount();
    const code = await requestEmailCode(account.email);
    const invalidCode = code === '000000' ? '111111' : '000000';

    await request(httpServer)
      .post('/v1/account/reauthenticate/email')
      .set(authHeaders(account.accessToken))
      .send({ code: invalidCode, email: account.email })
      .expect(401);

    await dataSource.query(
      `UPDATE auth.email_verification_codes
       SET expires_at = now() - interval '1 second'
       WHERE email = $1 AND consumed_at IS NULL AND superseded_at IS NULL`,
      [account.email],
    );
    await request(httpServer)
      .post('/v1/account/reauthenticate/email')
      .set(authHeaders(account.accessToken))
      .send({ code, email: account.email })
      .expect(401);
  });

  it('rejects a Guest principal from every reauthentication route', async () => {
    const guest = await newGuest();
    const headers = authHeaders(guest.accessToken);

    await request(httpServer)
      .get('/v1/account/reauthenticate/identities')
      .set(headers)
      .expect(403);
    await request(httpServer)
      .post('/v1/account/reauthenticate/firebase')
      .set(headers)
      .send({ idToken: fakeIdToken() })
      .expect(403);
    await request(httpServer)
      .post('/v1/account/reauthenticate/email')
      .set(headers)
      .send({ code: '000000', email: `guest-${randomUUID()}@example.test` })
      .expect(403);
  });

  it('cancels a pending deletion after reauthentication and returns to none', async () => {
    const account = await newAccount();
    const google = await linkFirebase(account, 'google');
    const oldToken = await staleSessionToken(account);

    await request(httpServer)
      .post('/v1/account/deletion')
      .set(authHeaders(oldToken))
      .send({ confirmation: 'DELETE' })
      .expect(401);
    const reauthenticated = await request(httpServer)
      .post('/v1/account/reauthenticate/firebase')
      .set(authHeaders(oldToken))
      .send({ idToken: google.idToken })
      .expect(200);
    const recentToken = readString(reauthenticated.body, 'accessToken');

    await expectDeletionSucceeds(recentToken);
    await request(httpServer)
      .post('/v1/account/deletion/cancel')
      .set(authHeaders(recentToken))
      .expect(200)
      .expect({ status: 'none' });
    await request(httpServer)
      .get('/v1/account/deletion')
      .set(authHeaders(recentToken))
      .expect(200)
      .expect({ status: 'none' });
  });
});
