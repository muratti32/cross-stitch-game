import 'reflect-metadata';

import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';
import { DataSource, IsNull } from 'typeorm';
import { PNG } from 'pngjs';

import { configureApi } from '../src/api/configure-api';
import { CatalogService } from '../src/catalog/catalog.service';
import { encodePatternArtifactV1 } from '../src/catalog/pattern-artifact-encoder';
import { LocalObjectStorage } from '../src/catalog/storage/local-object-storage';
import { OBJECT_STORAGE } from '../src/catalog/storage/object-storage.interface';
import {
  catalogPatternObjectKeys,
  personalPatternObjectKeys,
} from '../src/catalog/pattern-object-keys';
import { AppConfigService } from '../src/config/app-config.service';
import { SessionsService } from '../src/sessions/sessions.service';
import { ProgressCheckpointService } from '../src/sessions/progress-checkpoint.service';
import { StorageReconcilerService } from '../src/sessions/storage-reconciler.service';
import {
  AuthIdentityEntity,
  EmailVerificationCodeEntity,
  GuestInstallationEntity,
  GuestInstallationStatus,
  PrincipalType,
  RefreshTokenEntity,
  RefreshTokenStatus,
} from '../src/auth/entities';
import { EmailOutboxDispatcherService } from '../src/auth/email-outbox-dispatcher.service';
import { EmailOutboxEntity } from '../src/auth/email-outbox.entity';
import { LocalEmailSender } from '../src/auth/local-email-sender';
import { EMAIL_SENDER } from '../src/auth/email-sender.interface';
import { FIREBASE_IDENTITY_VERIFIER } from '../src/auth/firebase-identity-verifier';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_VERSION } from '../src/auth/auth.constants';
import { JobOutboxEntity } from '../src/jobs/entities/job-outbox.entity';
import { ProcessingJobStatus } from '../src/jobs/entities/processing-job-status.enum';
import { ProcessingJobEntity } from '../src/jobs/entities/processing-job.entity';
import { DEMO_JOB_EVENT_NAME } from '../src/jobs/jobs.constants';
import type { DemoJobConsumerService } from '../src/jobs/demo-job-consumer.service';
import type { DemoJobsQueueService } from '../src/jobs/demo-jobs-queue.service';
import type { OutboxDispatcherService } from '../src/jobs/outbox-dispatcher.service';
import type { ProcessingJobsRepository } from '../src/jobs/processing-jobs.repository';
import {
  ConversionEngineClient,
  ConversionEngineRequestError,
} from '../src/conversion/conversion-engine.client';
import { ConversionJobConsumerService } from '../src/conversion/conversion-job-consumer.service';
import {
  ConversionRecipeEntity,
  PatternConversionEntity,
  PersonalPatternEntity,
} from '../src/conversion/entities';
import { PatternEntity } from '../src/catalog/entities';
import { PATTERN_THUMBNAIL_RENDERER_VERSION } from '../src/conversion/pattern-thumbnail-renderer';
import * as thumbnailRenderer from '../src/conversion/pattern-thumbnail-renderer';
import { ObjectRegistryEntity } from '../src/sessions/entities';
import { CoinLedgerRepository } from '../src/economy/coin-ledger.repository';
import { CommerceLedgerRepository } from '../src/economy/commerce-ledger.repository';
import { utcRewardDay } from '../src/economy/reward-day';

class ForcedRollbackError extends Error {
  constructor() {
    super('Force the job creation transaction to roll back');
    this.name = ForcedRollbackError.name;
  }
}

describe('Stitch Wish backend integration', () => {
  let app: INestApplication;
  let httpServer: Server;
  let dataSource: DataSource;
  let processingJobs: ProcessingJobsRepository;
  let dispatcher: OutboxDispatcherService;
  let queue: DemoJobsQueueService;
  let consumer: DemoJobConsumerService;
  let emailDispatcher: EmailOutboxDispatcherService;
  let localEmailSender: LocalEmailSender;

  const GOOGLE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.google';
  const APPLE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.apple';
  const BOUND_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.bound';

  beforeAll(async () => {
    const [{ ApiAppModule }, jobs] = await Promise.all([
      import('../src/app.api.module'),
      import('../src/jobs'),
    ]);
    // The provider overrides pin the local email sender and local object storage so the suite stays offline regardless of what the environment happens to carry.
    const moduleRef = await Test.createTestingModule({
      imports: [ApiAppModule, jobs.JobsWorkerModule],
    })
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
          if (idToken === GOOGLE_JWT) {
            return Promise.resolve({
              email: 'google-user@example.com',
              provider: 'google',
              subject: 'google-sub-789',
            });
          }
          if (idToken === APPLE_JWT) {
            return Promise.resolve({
              email: 'apple-user@example.com',
              provider: 'apple',
              subject: 'apple-sub-789',
            });
          }
          if (idToken === BOUND_JWT) {
            return Promise.resolve({
              email: 'bound-user@example.com',
              provider: 'google',
              subject: 'already-bound-sub',
            });
          }
          return Promise.reject(new Error('Invalid token'));
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureApi(app);
    await app.init();

    httpServer = app.getHttpServer() as Server;
    dataSource = app.get(DataSource);
    processingJobs = app.get(jobs.ProcessingJobsRepository);
    dispatcher = app.get(jobs.OutboxDispatcherService);
    queue = app.get(jobs.DemoJobsQueueService);
    consumer = app.get(jobs.DemoJobConsumerService);
    emailDispatcher = app.get(EmailOutboxDispatcherService);
    localEmailSender = app.get(LocalEmailSender);
    await queue.waitUntilReady();
  });

  afterAll(async () => {
    if (app !== undefined) {
      await app.close();
    }
  });

  it('reports real PostgreSQL and Redis connectivity', async () => {
    await request(httpServer).get('/v1/health').expect(200).expect({
      checks: { postgres: 'up', redis: 'up' },
      status: 'ok',
    });
  });

  it('applies the global version prefix and strict request validation', async () => {
    await request(httpServer).get('/health').expect(404);
    await request(httpServer)
      .post('/v1/demo-jobs')
      .send({ message: 'validated', unexpected: true })
      .expect(400);
  });

  it('returns the same Guest Installation Identity with fresh sessions on retry', async () => {
    const installationKey = randomUUID();
    const credentialSecret = createCredentialSecret();

    const first = await createGuestThroughApi(
      httpServer,
      installationKey,
      credentialSecret,
    );
    const second = await createGuestThroughApi(
      httpServer,
      installationKey,
      credentialSecret,
    );

    expect(second.guestId).toBe(first.guestId);
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const count = await dataSource
      .getRepository(GuestInstallationEntity)
      .countBy({
        installationKeyHash: sha256(installationKey.toLowerCase()),
      });
    expect(count).toBe(1);
  });

  it('creates only one Guest Installation Identity under a concurrent retry', async () => {
    const installationKey = randomUUID();
    const credentialSecret = createCredentialSecret();

    const [first, second] = await Promise.all([
      createGuestThroughApi(
        httpServer,
        installationKey,
        credentialSecret,
      ),
      createGuestThroughApi(
        httpServer,
        installationKey,
        credentialSecret,
      ),
    ]);

    expect(second.guestId).toBe(first.guestId);
    const count = await dataSource
      .getRepository(GuestInstallationEntity)
      .countBy({
        installationKeyHash: sha256(installationKey.toLowerCase()),
      });
    expect(count).toBe(1);
  });

  it('rejects the wrong credential secret without returning session data', async () => {
    const installationKey = randomUUID();
    await createGuestThroughApi(
      httpServer,
      installationKey,
      createCredentialSecret(),
    );

    const response = await request(httpServer)
      .post('/v1/auth/guest')
      .send({
        credentialSecret: createCredentialSecret(),
        installationKey,
      })
      .expect(401);
    const body: unknown = response.body;

    expect(readRecord(body, 'accessToken')).toBeUndefined();
    expect(readRecord(body, 'refreshToken')).toBeUndefined();
    expect(readRecord(body, 'guestId')).toBeUndefined();
  });

  it('rotates refresh tokens and revokes the entire family on reuse', async () => {
    const created = await createGuestThroughApi(
      httpServer,
      randomUUID(),
      createCredentialSecret(),
    );
    const refreshed = await refreshThroughApi(
      httpServer,
      created.refreshToken,
    );

    expect(refreshed.refreshToken).not.toBe(created.refreshToken);
    await request(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: created.refreshToken })
      .expect(401);
    await request(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: refreshed.refreshToken })
      .expect(401);

    const originalToken = await dataSource
      .getRepository(RefreshTokenEntity)
      .findOneByOrFail({
        tokenHash: sha256(created.refreshToken),
      });
    const family = await dataSource
      .getRepository(RefreshTokenEntity)
      .findBy({ familyId: originalToken.familyId });
    expect(family).toHaveLength(2);
    expect(
      family.every((token) => token.status === RefreshTokenStatus.Revoked),
    ).toBe(true);
  });

  it('returns the current principal only for a valid access JWT', async () => {
    // Capture timestamp before guest/token creation to ensure it genuinely precedes issuance.
    const beforeTokenMinting = Math.floor(Date.now() / 1_000);
    const created = await createGuestThroughApi(
      httpServer,
      randomUUID(),
      createCredentialSecret(),
    );

    await request(httpServer).get('/v1/auth/session').expect(401);
    const session = await request(httpServer)
      .get('/v1/auth/session')
      .set('Authorization', `Bearer ${created.accessToken}`)
      .expect(200);
    const afterSessionRead = Math.floor(Date.now() / 1_000);
    expect(session.body).toMatchObject({
      id: created.guestId,
      tokenVersion: ACCESS_TOKEN_VERSION,
      type: PrincipalType.Guest,
    });
    const authTime = readRecord(session.body, 'authTime');
    expect(typeof authTime).toBe('number');
    expect(authTime as number).toBeGreaterThanOrEqual(beforeTokenMinting);
    expect(authTime as number).toBeLessThanOrEqual(afterSessionRead);
    expect(Object.keys(session.body).sort()).toEqual([
      'authTime',
      'id',
      'tokenVersion',
      'type',
    ]);
  });

  it('logs out a refresh family idempotently', async () => {
    const created = await createGuestThroughApi(
      httpServer,
      randomUUID(),
      createCredentialSecret(),
    );

    await request(httpServer)
      .post('/v1/auth/logout')
      .send({ refreshToken: created.refreshToken })
      .expect(204);
    await request(httpServer)
      .post('/v1/auth/logout')
      .send({ refreshToken: created.refreshToken })
      .expect(204);
    await request(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: created.refreshToken })
      .expect(401);
  });

  async function requestEmailOtp(server: Server, email: string): Promise<void> {
    await request(server)
      .post('/v1/auth/email/request')
      .send({ email })
      .expect(202)
      .expect({ status: 'sent' });
  }

  async function dispatchAndReadEmailOtp(email: string): Promise<string> {
    // A single dispatchOnce() call processes a batch of 25 emails. If there is a deep backlog
    // of undispatched emails, the target email might not be processed in the first round.
    // We loop to drain the outbox, checking for the target email delivery after each round.
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
      `Email OTP delivery was not recorded for ${email} after ${rounds} dispatch rounds`,
    );
  }

  describe('email authentication', () => {
    it('requests, verifies, opens an account, and issues an account session', async () => {
      const email = 'email-happy@example.test';
      await requestEmailOtp(httpServer, email);
      const code = await dispatchAndReadEmailOtp(email);

      const verified = await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ code, email })
        .expect(200);
      const response = readRecord(verified.body, 'accountId');
      expect(typeof response).toBe('string');
      expect(readStringRecord(verified.body, 'accessToken')).toEqual(expect.any(String));
      expect(readStringRecord(verified.body, 'refreshToken')).toEqual(expect.any(String));

      const identity = await dataSource
        .getRepository(AuthIdentityEntity)
        .findOneByOrFail({ email, provider: 'email' });
      expect(identity.accountId).toBe(response);
    });

    it('returns an identical opaque request response for existing and new email addresses', async () => {
      const existing = 'email-existing@example.test';
      await requestEmailOtp(httpServer, existing);
      const existingCode = await dispatchAndReadEmailOtp(existing);
      await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ code: existingCode, email: existing })
        .expect(200);

      const [existingResponse, newResponse] = await Promise.all([
        request(httpServer).post('/v1/auth/email/request').send({ email: existing }),
        request(httpServer)
          .post('/v1/auth/email/request')
          .send({ email: 'email-new@example.test' }),
      ]);
      expect(existingResponse.status).toBe(202);
      expect(newResponse.status).toBe(202);
      expect(existingResponse.body).toEqual({ status: 'sent' });
      expect(newResponse.body).toEqual(existingResponse.body);
    });

    it('rejects a consumed code and an expired code', async () => {
      const consumedEmail = 'email-consumed@example.test';
      await requestEmailOtp(httpServer, consumedEmail);
      const consumedCode = await dispatchAndReadEmailOtp(consumedEmail);
      await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ code: consumedCode, email: consumedEmail })
        .expect(200);
      await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ code: consumedCode, email: consumedEmail })
        .expect(401);

      const expiredEmail = 'email-expired@example.test';
      await requestEmailOtp(httpServer, expiredEmail);
      const expiredCode = await dispatchAndReadEmailOtp(expiredEmail);
      await dataSource.getRepository(EmailVerificationCodeEntity).update(
        { email: expiredEmail },
        { expiresAt: new Date(Date.now() - 1_000) },
      );
      await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ code: expiredCode, email: expiredEmail })
        .expect(401);
    });

    it('supersedes a previous request and re-dispatches the same outbox code', async () => {
      const email = 'email-supersede@example.test';
      await requestEmailOtp(httpServer, email);
      const firstCode = await dispatchAndReadEmailOtp(email);
      await requestEmailOtp(httpServer, email);
      const secondCode = await dispatchAndReadEmailOtp(email);
      expect(secondCode).not.toBe(firstCode);
      await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ code: firstCode, email })
        .expect(401);
      await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ code: secondCode, email })
        .expect(200);

      const outbox = await dataSource
        .getRepository(EmailOutboxEntity)
        .findOneByOrFail({ toEmail: email });
      await dataSource.getRepository(EmailOutboxEntity).update(
        { id: outbox.id },
        { dispatchedAt: null },
      );
      const beforeRedelivery = localEmailSender.getDeliveries().length;
      let rounds = 0;
      const maxRounds = 20;
      let redelivered: ReturnType<LocalEmailSender['getDeliveries']>[number] | undefined;
      while (rounds < maxRounds) {
        rounds++;
        const dispatchedCount = await emailDispatcher.dispatchOnce();
        redelivered = localEmailSender
          .getDeliveries()
          .slice(beforeRedelivery)
          .reverse()
          .find((candidate) => candidate.toEmail === email);
        if (redelivered !== undefined) {
          break;
        }
        if (dispatchedCount === 0) {
          break;
        }
      }
      expect(redelivered?.code).toBe(firstCode);
      const activeCodes = await dataSource
        .getRepository(EmailVerificationCodeEntity)
        .countBy({ email, consumedAt: IsNull(), supersededAt: IsNull() });
      expect(activeCodes).toBe(0);
    });
  });

  describe('auth identity linking', () => {
    it('links and unlinks Apple/Google and Email identities with reauth check', async () => {
      // 1. Create a registered account via Email OTP
      const email = `link-test-${randomUUID()}@example.test`;
      await requestEmailOtp(httpServer, email);
      const code = await dispatchAndReadEmailOtp(email);
      const verified = await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ code, email })
        .expect(200);

      const accountId = readStringRecord(verified.body, 'accountId');
      const accessToken = readStringRecord(verified.body, 'accessToken');

      // 2. Link a Google provider using Firebase token
      await request(httpServer)
        .post('/v1/auth/identities/link/firebase')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ idToken: GOOGLE_JWT })
        .expect(204);

      // Verify it was added to database
      const googleIdentity = await dataSource
        .getRepository(AuthIdentityEntity)
        .findOneByOrFail({ accountId, provider: 'google', subject: 'google-sub-789' });
      expect(googleIdentity.email).toBe('google-user@example.com');

      // 3. Link an Apple provider using Firebase token
      await request(httpServer)
        .post('/v1/auth/identities/link/firebase')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ idToken: APPLE_JWT })
        .expect(204);

      // Verify it was added to database
      const appleIdentity = await dataSource
        .getRepository(AuthIdentityEntity)
        .findOneByOrFail({ accountId, provider: 'apple', subject: 'apple-sub-789' });
      expect(appleIdentity.email).toBe('apple-user@example.com');

      // 4. Try to link an already bound Google provider (should fail with Conflict 409)
      const email2 = `link-test-2-${randomUUID()}@example.test`;
      await requestEmailOtp(httpServer, email2);
      const code2 = await dispatchAndReadEmailOtp(email2);
      const verified2 = await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ code: code2, email: email2 })
        .expect(200);
      const accessToken2 = readStringRecord(verified2.body, 'accessToken');

      await request(httpServer)
        .post('/v1/auth/identities/link/firebase')
        .set('Authorization', `Bearer ${accessToken2}`)
        .send({ idToken: BOUND_JWT })
        .expect(204);

      await request(httpServer)
        .post('/v1/auth/identities/link/firebase')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ idToken: BOUND_JWT })
        .expect(409);

      // 5. Try to link with an expired reauth token (should fail 401)
      const jwtService = app.get(JwtService);
      const expiredToken = await jwtService.signAsync({
        jti: randomUUID(),
        principalType: PrincipalType.Account,
        sub: accountId,
        tokenVersion: ACCESS_TOKEN_VERSION,
        authTime: Math.floor(Date.now() / 1000) - 600, // 10 minutes ago
      });

      await request(httpServer)
        .post('/v1/auth/identities/link/firebase')
        .set('Authorization', `Bearer ${expiredToken}`)
        .send({ idToken: GOOGLE_JWT })
        .expect(401);

      // 6. Unlink Google identity (should succeed)
      await request(httpServer)
        .post('/v1/auth/identities/unlink')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ provider: 'google', subject: 'google-sub-789' })
        .expect(204);

      // Verify database
      const checkGoogle = await dataSource
        .getRepository(AuthIdentityEntity)
        .findOneBy({ accountId, provider: 'google', subject: 'google-sub-789' });
      expect(checkGoogle).toBeNull();

      // 7. Unlink Apple identity (should succeed)
      await request(httpServer)
        .post('/v1/auth/identities/unlink')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ provider: 'apple', subject: 'apple-sub-789' })
        .expect(204);

      // Verify database
      const checkApple = await dataSource
        .getRepository(AuthIdentityEntity)
        .findOneBy({ accountId, provider: 'apple', subject: 'apple-sub-789' });
      expect(checkApple).toBeNull();

      // 8. Try to unlink the last remaining identity (email) (should fail 400)
      await request(httpServer)
        .post('/v1/auth/identities/unlink')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ provider: 'email', subject: email })
        .expect(400);

      // 9. Link a new email address (should succeed)
      const newEmail = `link-email-${randomUUID()}@example.test`;
      await requestEmailOtp(httpServer, newEmail);
      const newEmailCode = await dispatchAndReadEmailOtp(newEmail);

      await request(httpServer)
        .post('/v1/auth/identities/link/email')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ email: newEmail, code: newEmailCode })
        .expect(204);

      // Verify database has new email linked
      await dataSource
        .getRepository(AuthIdentityEntity)
        .findOneByOrFail({ accountId, provider: 'email', subject: newEmail });

      // 10. Unlink the original email address (should succeed now that we have two identities)
      await request(httpServer)
        .post('/v1/auth/identities/unlink')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ provider: 'email', subject: email })
        .expect(204);

      // Verify database
      const checkOriginalEmail = await dataSource
        .getRepository(AuthIdentityEntity)
        .findOneBy({ accountId, provider: 'email', subject: email });
      expect(checkOriginalEmail).toBeNull();
    });
  });

  it('rejects refresh and revokes the family for an inactive guest', async () => {
    const created = await createGuestThroughApi(
      httpServer,
      randomUUID(),
      createCredentialSecret(),
    );
    await dataSource.getRepository(GuestInstallationEntity).update(
      { id: created.guestId },
      { status: GuestInstallationStatus.Revoked },
    );

    await request(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: created.refreshToken })
      .expect(401);

    const refreshToken = await dataSource
      .getRepository(RefreshTokenEntity)
      .findOneByOrFail({
        tokenHash: sha256(created.refreshToken),
      });
    expect(refreshToken.status).toBe(RefreshTokenStatus.Revoked);
  });

  it('resets a guest, revoking all tokens, verifying idempotency, and preventing session issuance with the same key', async () => {
    const installationKey = randomUUID();
    const credentialSecret = createCredentialSecret();

    const created = await createGuestThroughApi(
      httpServer,
      installationKey,
      credentialSecret,
    );

    // reset -> 204
    await request(httpServer)
      .post('/v1/auth/guest/reset')
      .set('Authorization', `Bearer ${created.accessToken}`)
      .expect(204);

    // idempotent: calling again with still-valid access token (revoked installation) -> 204
    await request(httpServer)
      .post('/v1/auth/guest/reset')
      .set('Authorization', `Bearer ${created.accessToken}`)
      .expect(204);

    // refresh with old token -> 401
    await request(httpServer)
      .post('/v1/auth/refresh')
      .send({ refreshToken: created.refreshToken })
      .expect(401);

    // POST /v1/auth/guest same key+secret -> 401
    await request(httpServer)
      .post('/v1/auth/guest')
      .send({ installationKey, credentialSecret })
      .expect(401);

    // fresh key+secret -> 201 new guestId
    const freshInstallationKey = randomUUID();
    const freshCredentialSecret = createCredentialSecret();
    const freshCreated = await createGuestThroughApi(
      httpServer,
      freshInstallationKey,
      freshCredentialSecret,
    );
    expect(freshCreated.guestId).not.toBe(created.guestId);
  });

  it('commits the Processing Job and Job Outbox row together', async () => {
    const processingJobId = await createDemoJobThroughApi(
      httpServer,
      'atomic commit',
    );

    const [processingJob, outbox] = await Promise.all([
      dataSource
        .getRepository(ProcessingJobEntity)
        .findOneBy({ id: processingJobId }),
      dataSource
        .getRepository(JobOutboxEntity)
        .findOneBy({ processingJobId }),
    ]);

    expect(processingJob).not.toBeNull();
    expect(processingJob?.status).toBe(ProcessingJobStatus.Pending);
    expect(outbox).not.toBeNull();
    expect(outbox?.processingJobId).toBe(processingJobId);
    expect(outbox?.dispatchedAt).toBeNull();
  });

  it('rolls back both records when the creation transaction fails', async () => {
    let processingJobId: string | null = null;
    let outboxId: string | null = null;

    await expect(
      dataSource.transaction(async (manager) => {
        const created = await processingJobs.createPendingWithOutbox(manager, {
          message: 'atomic rollback',
        });
        processingJobId = created.job.id;
        outboxId = created.outbox.id;
        throw new ForcedRollbackError();
      }),
    ).rejects.toBeInstanceOf(ForcedRollbackError);

    if (processingJobId === null || outboxId === null) {
      throw new Error('The rollback fixture did not create both records');
    }

    const [processingJob, outbox] = await Promise.all([
      dataSource
        .getRepository(ProcessingJobEntity)
        .findOneBy({ id: processingJobId }),
      dataSource.getRepository(JobOutboxEntity).findOneBy({ id: outboxId }),
    ]);

    expect(processingJob).toBeNull();
    expect(outbox).toBeNull();
  });

  it('publishes an outbox row with its UUID as the BullMQ jobId', async () => {
    const processingJobId = await createDemoJobThroughApi(
      httpServer,
      'dispatcher identity',
    );
    const outbox = await dataSource
      .getRepository(JobOutboxEntity)
      .findOneByOrFail({ processingJobId });

    const dispatchedCount = await dispatcher.dispatchOnce();
    const bullJob = await queue.getJob(outbox.id);
    const processingJob = await processingJobs.findById(processingJobId);

    expect(dispatchedCount).toBeGreaterThanOrEqual(1);
    expect(bullJob?.id).toBe(outbox.id);
    expect(bullJob?.data).toEqual({ processingJobId });
    expect(processingJob?.status).toBe(ProcessingJobStatus.Dispatched);
  });

  it('reconciles a nonterminal PostgreSQL job after Redis queue loss', async () => {
    const processingJobId = await createDemoJobThroughApi(
      httpServer,
      'redis recovery',
    );
    const outbox = await dataSource
      .getRepository(JobOutboxEntity)
      .findOneByOrFail({ processingJobId });

    await dispatcher.dispatchOnce();
    const originalBullJob = await queue.getJob(outbox.id);
    if (originalBullJob === undefined) {
      throw new Error('Dispatcher did not create the Redis recovery fixture');
    }
    await originalBullJob.remove();
    expect(await queue.getJob(outbox.id)).toBeUndefined();

    const reconciledCount = await dispatcher.reconcileOnce();
    const restoredBullJob = await queue.getJob(outbox.id);

    expect(reconciledCount).toBeGreaterThanOrEqual(1);
    expect(restoredBullJob?.id).toBe(outbox.id);
    expect(restoredBullJob?.data).toEqual({ processingJobId });
  });

  it('completes the API-to-outbox-to-BullMQ path and ignores a terminal replay', async () => {
    const processingJobId = await createDemoJobThroughApi(
      httpServer,
      'stitch wish',
    );
    const outbox = await dataSource
      .getRepository(JobOutboxEntity)
      .findOneByOrFail({ processingJobId });

    await dispatcher.dispatchOnce();

    await consumer.start();

    const completed = await waitForProcessingJob(
      processingJobs,
      processingJobId,
      ProcessingJobStatus.Completed,
    );
    const completedAt = completed.updatedAt.toISOString();
    expect(completed.result).toEqual({
      echo: 'stitch wish',
      uppercase: 'STITCH WISH',
    });

    const replayDeliveryId = `replay-${outbox.id}`;
    await queue.bullQueue.add(
      DEMO_JOB_EVENT_NAME,
      { processingJobId },
      { jobId: replayDeliveryId },
    );
    await waitForBullJobState(queue, replayDeliveryId, 'completed');
    const replayedBullJob = await queue.getJob(replayDeliveryId);
    expect(replayedBullJob?.returnvalue).toEqual({
      outcome: 'terminal-replay',
      processingJobId,
    });

    const afterReplay = await processingJobs.findById(processingJobId);
    expect(afterReplay?.status).toBe(ProcessingJobStatus.Completed);
    expect(afterReplay?.result).toEqual(completed.result);
    expect(afterReplay?.updatedAt.toISOString()).toBe(completedAt);

    const response = await request(httpServer)
      .get(`/v1/demo-jobs/${processingJobId}`)
      .expect(200);
    const body: unknown = response.body;
    expect(readRecord(body, 'status')).toBe(ProcessingJobStatus.Completed);
    expect(readRecord(body, 'result')).toEqual(completed.result);
  });

  describe('photo Pattern Conversion', () => {
    async function createAccount(): Promise<{
      accountId: string;
      accessToken: string;
    }> {
      const email = `conversion-${randomUUID()}@example.test`;
      await request(httpServer)
        .post('/v1/auth/email/request')
        .send({ email })
        .expect(202);
      const code = await dispatchAndReadEmailOtp(email);
      const verified = await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ email, code })
        .expect(200);
      return {
        accountId: readStringRecord(verified.body, 'accountId'),
        accessToken: readStringRecord(verified.body, 'accessToken'),
      };
    }

    function framedArtwork(width = 120, height = 80): Buffer {
      const png = new PNG({ height, width });
      for (let offset = 0; offset < png.data.length; offset += 4) {
        png.data[offset] = 32;
        png.data[offset + 1] = 120;
        png.data[offset + 2] = 180;
        png.data[offset + 3] = 255;
      }
      return PNG.sync.write(png);
    }

    function mockSuccessfulEngine() {
      const preview = framedArtwork(2, 2).toString('base64');
      return jest
        .spyOn(app.get(ConversionEngineClient), 'convert')
        .mockImplementation((input) => {
          const width = Math.round(input.shortEdgeCells * 1.5);
          const height = input.shortEdgeCells;
          return Promise.resolve({
            dmc_palette_version: 'dmc-itest-v1',
            engine_version: 'itest-engine-v1',
            grid: Buffer.alloc(width * height, 1).toString('base64'),
            palette: [
              { dmc_code: '995', name: 'Electric Blue Dark', rgb_hex: '#2696B6' },
            ],
            preview_png: preview,
            recipe_version: 'v1',
            statistics: {
              distinct_colors: 1,
              height,
              total_stitchable_cells: width * height,
              width,
            },
          });
        });
    }

    async function requestConversion(
      accessToken: string,
      title: string,
    ): Promise<string> {
      const response = await request(httpServer)
        .post('/v1/conversions/photo')
        .set('Authorization', `Bearer ${accessToken}`)
        .field('profile', 'easy')
        .field('title', title)
        .attach('artwork', framedArtwork(), {
          contentType: 'image/png',
          filename: 'approved-frame.png',
        })
        .expect(202);
      return readStringRecord(response.body, 'id');
    }

    async function runConversion(processingJobId: string): Promise<void> {
      expect(await processingJobs.markDispatched(processingJobId)).toBe(true);
      await app
        .get(ConversionJobConsumerService)
        .processDelivery(processingJobId);
    }

    it('creates repeatable private Personal Patterns and prepares them through the normal session path', async () => {
      const engine = mockSuccessfulEngine();
      const account = await createAccount();
      const guest = await createGuestThroughApi(
        httpServer,
        randomUUID(),
        createCredentialSecret(),
      );

      await request(httpServer)
        .post('/v1/conversions/photo')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .field('profile', 'easy')
        .field('title', 'Guest attempt')
        .attach('artwork', framedArtwork(), {
          contentType: 'image/png',
          filename: 'approved-frame.png',
        })
        .expect(403);

      const firstJobId = await requestConversion(
        account.accessToken,
        'First photo pattern',
      );
      const [pendingJob, outbox, conversion] = await Promise.all([
        processingJobs.findById(firstJobId),
        dataSource.getRepository(JobOutboxEntity).findOneBy({
          processingJobId: firstJobId,
        }),
        dataSource.getRepository(PatternConversionEntity).findOneBy({
          processingJobId: firstJobId,
        }),
      ]);
      expect(pendingJob?.status).toBe(ProcessingJobStatus.Pending);
      expect(outbox).not.toBeNull();
      expect(conversion?.accountId).toBe(account.accountId);
      expect(
        await app
          .get(LocalObjectStorage)
          .exists(conversion?.uploadObjectKey ?? ''),
      ).toBe(true);

      await consumer.start();
      await dispatcher.dispatchOnce();
      const completed = await waitForProcessingJob(
        processingJobs,
        firstJobId,
        ProcessingJobStatus.Completed,
      );
      expect(completed?.status).toBe(ProcessingJobStatus.Completed);
      await waitFor(
        async () => {
          const exists = await app
            .get(LocalObjectStorage)
            .exists(conversion?.uploadObjectKey ?? '');
          return !exists ? true : null;
        },
        `upload object ${conversion?.uploadObjectKey ?? ''} to be deleted`,
      );

      const firstPatternId = readStringRecord(completed?.result, 'patternId');
      const recipe = await dataSource
        .getRepository(ConversionRecipeEntity)
        .findOneByOrFail({ patternId: firstPatternId });
      expect(recipe).toMatchObject({
        dmcPaletteVersion: 'dmc-itest-v1',
        engineVersion: 'itest-engine-v1',
        height: 50,
        maxColors: 12,
        profile: 'easy',
        shortEdgeCells: 50,
        width: 75,
      });

      const firstPatternRow = await dataSource
        .getRepository(PatternEntity)
        .findOneByOrFail({ id: firstPatternId });
      expect(firstPatternRow.thumbnailRendererVersion).toBe(PATTERN_THUMBNAIL_RENDERER_VERSION);

      const firstPatternKeys = personalPatternObjectKeys(firstPatternId);
      const storage = app.get(LocalObjectStorage);
      expect(await storage.exists(firstPatternKeys.thumbnailBrowsing)).toBe(true);
      expect(await storage.exists(firstPatternKeys.thumbnailDetail)).toBe(true);

      const [firstBrowsingRow, firstDetailRow] = await Promise.all([
        dataSource
          .getRepository(ObjectRegistryEntity)
          .findOneByOrFail({ objectKey: firstPatternKeys.thumbnailBrowsing }),
        dataSource
          .getRepository(ObjectRegistryEntity)
          .findOneByOrFail({ objectKey: firstPatternKeys.thumbnailDetail }),
      ]);
      expect(firstBrowsingRow.state).toBe('available');
      expect(firstBrowsingRow.missing).toBe(false);
      expect(firstDetailRow.state).toBe('available');
      expect(firstDetailRow.missing).toBe(false);

      const ownerList = await request(httpServer)
        .get('/v1/conversions/patterns')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      const ownerListBody: unknown = ownerList.body;
      if (!Array.isArray(ownerListBody) || ownerListBody.length !== 1) {
        throw new Error('Personal Pattern list did not contain one item');
      }
      expect(readStringRecord(ownerListBody[0], 'id')).toBe(firstPatternId);
      const previewUrl = readStringRecord(ownerListBody[0], 'previewUrl');
      await request(httpServer).get(previewUrl).expect(200).expect('Content-Type', /png/);

      const thumbnailUrls = readRecord(ownerListBody[0], 'thumbnailUrls');
      expect(thumbnailUrls).not.toBeNull();
      const browsingThumbnailUrl = readStringRecord(thumbnailUrls, 'browsing');
      const detailThumbnailUrl = readStringRecord(thumbnailUrls, 'detail');
      await request(httpServer)
        .get(browsingThumbnailUrl)
        .expect(200)
        .expect('Content-Type', /image\/png/);
      await request(httpServer)
        .get(detailThumbnailUrl)
        .expect(200)
        .expect('Content-Type', /image\/png/);

      const tamperedUrl = new URL(browsingThumbnailUrl, 'http://localhost');
      const signature = tamperedUrl.searchParams.get('sig');
      if (signature === null) {
        throw new Error('Thumbnail URL did not contain a signature');
      }
      tamperedUrl.searchParams.set(
        'sig',
        `${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`,
      );
      await request(httpServer)
        .get(`${tamperedUrl.pathname}${tamperedUrl.search}`)
        .expect(403);

      const expiredExpiration = Math.floor(Date.now() / 1000) - 1;
      const expiredUrl = new URL(detailThumbnailUrl, 'http://localhost');
      expiredUrl.searchParams.set('exp', String(expiredExpiration));
      expiredUrl.searchParams.set(
        'sig',
        createHmac('sha256', app.get(AppConfigService).grantSigningSecret)
          .update(`personal-preview:${firstPatternId}:${expiredExpiration}`)
          .digest('hex'),
      );
      await request(httpServer)
        .get(`${expiredUrl.pathname}${expiredUrl.search}`)
        .expect(403);

      await request(httpServer)
        .get(`/v1/catalog/patterns/${firstPatternId}`)
        .expect(404);
      await request(httpServer)
        .post('/v1/sessions/prepare')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId: firstPatternId })
        .expect(404);
      const prepared = await request(httpServer)
        .post('/v1/sessions/prepare')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ patternId: firstPatternId })
        .expect(201);
      const grant = readRecord(prepared.body, 'grant') as { url: string };
      await request(httpServer).get(grant.url).expect(200);

      const secondJobId = await requestConversion(
        account.accessToken,
        'Second photo pattern',
      );
      await runConversion(secondJobId);
      const secondCompleted = await processingJobs.findById(secondJobId);
      const secondPatternId = readStringRecord(
        secondCompleted?.result,
        'patternId',
      );
      expect(secondPatternId).not.toBe(firstPatternId);
      const [firstPattern, secondPattern, personalCount] = await Promise.all([
        dataSource.getRepository(PatternEntity).findOneByOrFail({ id: firstPatternId }),
        dataSource.getRepository(PatternEntity).findOneByOrFail({ id: secondPatternId }),
        dataSource.getRepository(PersonalPatternEntity).countBy({
          ownerAccountId: account.accountId,
        }),
      ]);
      expect(firstPattern.artifactChecksum).toBe(secondPattern.artifactChecksum);
      expect(personalCount).toBe(2);

      const replay = await app
        .get(ConversionJobConsumerService)
        .processDelivery(firstJobId);
      expect(replay.outcome).toBe('terminal-replay');
      expect(
        await dataSource.getRepository(PersonalPatternEntity).countBy({
          ownerAccountId: account.accountId,
        }),
      ).toBe(2);
      engine.mockRestore();
    });

    it('deletes the temporary Conversion Upload after terminal failure', async () => {
      const engine = jest
        .spyOn(app.get(ConversionEngineClient), 'convert')
        .mockRejectedValue(
          new ConversionEngineRequestError('malformed artwork', false),
        );
      const account = await createAccount();
      const jobId = await requestConversion(account.accessToken, 'Will fail');
      const conversion = await dataSource
        .getRepository(PatternConversionEntity)
        .findOneByOrFail({ processingJobId: jobId });

      expect(await processingJobs.markDispatched(jobId)).toBe(true);
      await expect(
        app.get(ConversionJobConsumerService).processDelivery(jobId),
      ).rejects.toThrow('malformed artwork');
      expect((await processingJobs.findById(jobId))?.status).toBe(
        ProcessingJobStatus.Failed,
      );
      expect(
        await app.get(LocalObjectStorage).exists(conversion.uploadObjectKey),
      ).toBe(false);
      expect(
        await dataSource.getRepository(PersonalPatternEntity).countBy({
          processingJobId: jobId,
        }),
      ).toBe(0);
      engine.mockRestore();
    });

    it('resumes a transiently failed job into the same deterministic target', async () => {
      const engine = mockSuccessfulEngine();
      engine.mockRejectedValueOnce(
        new ConversionEngineRequestError('engine at capacity', true),
      );
      const account = await createAccount();
      const jobId = await requestConversion(account.accessToken, 'Retry target');
      const conversion = await dataSource
        .getRepository(PatternConversionEntity)
        .findOneByOrFail({ processingJobId: jobId });
      expect(await processingJobs.markDispatched(jobId)).toBe(true);

      await expect(
        app.get(ConversionJobConsumerService).processDelivery(jobId),
      ).rejects.toThrow('engine at capacity');
      expect((await processingJobs.findById(jobId))?.status).toBe(
        ProcessingJobStatus.Running,
      );
      expect(
        await app.get(LocalObjectStorage).exists(conversion.uploadObjectKey),
      ).toBe(true);

      const resumed = await app
        .get(ConversionJobConsumerService)
        .processDelivery(jobId);
      expect(resumed.outcome).toBe('resumed-and-completed');
      const completed = await processingJobs.findById(jobId);
      expect(readStringRecord(completed?.result, 'patternId')).toBe(
        conversion.targetPatternId,
      );
      expect(
        await dataSource.getRepository(PersonalPatternEntity).countBy({
          processingJobId: jobId,
        }),
      ).toBe(1);
      expect(
        await app.get(LocalObjectStorage).exists(conversion.uploadObjectKey),
      ).toBe(false);
      engine.mockRestore();
    });

    it('rejects a duplicate Personal Pattern title with 409 until the user renames', async () => {
      const engine = mockSuccessfulEngine();
      const account = await createAccount();

      const completedJobId = await requestConversion(
        account.accessToken,
        'Sunset Meadow',
      );
      await runConversion(completedJobId);

      async function attemptConversion(title: string) {
        return request(httpServer)
          .post('/v1/conversions/photo')
          .set('Authorization', `Bearer ${account.accessToken}`)
          .field('profile', 'easy')
          .field('title', title)
          .attach('artwork', framedArtwork(), {
            contentType: 'image/png',
            filename: 'approved-frame.png',
          });
      }

      const exactDuplicate = await attemptConversion('Sunset Meadow');
      expect(exactDuplicate.status).toBe(409);
      expect(readStringRecord(exactDuplicate.body, 'message')).toContain(
        'already have a Personal Pattern named "Sunset Meadow"',
      );

      const caseInsensitiveDuplicate = await attemptConversion('  sunset meadow ');
      expect(caseInsensitiveDuplicate.status).toBe(409);

      await requestConversion(account.accessToken, 'Pending Meadow');
      const pendingDuplicate = await attemptConversion('Pending Meadow');
      expect(pendingDuplicate.status).toBe(409);
      expect(readStringRecord(pendingDuplicate.body, 'message')).toContain(
        'already in progress',
      );

      const renamedJobId = await requestConversion(
        account.accessToken,
        'Sunset Meadow II',
      );
      await runConversion(renamedJobId);

      const otherAccount = await createAccount();
      await requestConversion(otherAccount.accessToken, 'Sunset Meadow');
      engine.mockRestore();
    });

    it('derives a Personal Pattern from an edit, idempotently, with lineage', async () => {
      const engine = mockSuccessfulEngine();
      const account = await createAccount();
      const sourceJobId = await requestConversion(account.accessToken, 'Editable Source');
      await runConversion(sourceJobId);
      const sourceCompleted = await processingJobs.findById(sourceJobId);
      const sourcePatternId = readStringRecord(sourceCompleted?.result, 'patternId');

      const clientPatternId = randomUUID();
      const grid = Buffer.from([1, 0, 1, 0]);
      const derivePayload = {
        patternId: clientPatternId,
        sourcePatternId,
        title: 'Edited Copy',
        width: 2,
        height: 2,
        palette: [{ dmcCode: '310', name: 'Black', rgbHex: '#000000' }],
        grid: grid.toString('base64'),
      };

      const first = await request(httpServer)
        .post('/v1/conversions/personal-patterns/derived')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send(derivePayload)
        .expect(201);
      expect(readStringRecord(first.body, 'id')).toBe(clientPatternId);
      expect(first.body).toMatchObject({ alreadyExists: false, title: 'Edited Copy', width: 2, height: 2 });

      const derivedPersonal = await dataSource
        .getRepository(PersonalPatternEntity)
        .findOneByOrFail({ patternId: clientPatternId });
      expect(derivedPersonal.processingJobId).toBeNull();
      expect(derivedPersonal.derivedFromPatternId).toBe(sourcePatternId);

      const derivedPattern = await dataSource
        .getRepository(PatternEntity)
        .findOneByOrFail({ id: clientPatternId });
      expect(derivedPattern.thumbnailRendererVersion).toBe(PATTERN_THUMBNAIL_RENDERER_VERSION);

      const derivedKeys = personalPatternObjectKeys(clientPatternId);
      const storage = app.get(LocalObjectStorage);
      expect(await storage.exists(derivedKeys.thumbnailBrowsing)).toBe(true);
      expect(await storage.exists(derivedKeys.thumbnailDetail)).toBe(true);

      const [derivedBrowsingRow, derivedDetailRow] = await Promise.all([
        dataSource
          .getRepository(ObjectRegistryEntity)
          .findOneByOrFail({ objectKey: derivedKeys.thumbnailBrowsing }),
        dataSource
          .getRepository(ObjectRegistryEntity)
          .findOneByOrFail({ objectKey: derivedKeys.thumbnailDetail }),
      ]);
      expect(derivedBrowsingRow.state).toBe('available');
      expect(derivedBrowsingRow.missing).toBe(false);
      expect(derivedDetailRow.state).toBe('available');
      expect(derivedDetailRow.missing).toBe(false);

      const previewUrl = readStringRecord(first.body, 'previewUrl');
      await request(httpServer).get(previewUrl).expect(200).expect('Content-Type', /png/);

      const thumbnailUrls = readRecord(first.body, 'thumbnailUrls');
      expect(thumbnailUrls).not.toBeNull();
      await request(httpServer)
        .get(readStringRecord(thumbnailUrls, 'browsing'))
        .expect(200)
        .expect('Content-Type', /image\/png/);
      await request(httpServer)
        .get(readStringRecord(thumbnailUrls, 'detail'))
        .expect(200)
        .expect('Content-Type', /image\/png/);

      // Idempotent replay: same clientPatternId, no duplicate row, alreadyExists true.
      const replay = await request(httpServer)
        .post('/v1/conversions/personal-patterns/derived')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send(derivePayload)
        .expect(201);
      expect(replay.body).toMatchObject({ alreadyExists: true, id: clientPatternId });
      expect(
        await dataSource.getRepository(PatternEntity).countBy({ id: clientPatternId }),
      ).toBe(1);

      // The derived pattern now appears in the owner's Personal Pattern list
      // alongside the source, and the list endpoint does not 404 despite the
      // derived pattern having no Conversion Recipe row.
      const list = await request(httpServer)
        .get('/v1/conversions/patterns')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      const ids = (list.body as Array<{ id: string }>).map((p) => p.id).sort();
      expect(ids).toEqual([sourcePatternId, clientPatternId].sort());

      engine.mockRestore();
    });

    it('creates a playable derived Personal Pattern with no Thumbnail when the Thumbnail renderer fails', async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const renderSpy = jest
        .spyOn(thumbnailRenderer, 'renderPatternThumbnailPng')
        .mockImplementation(() => {
          throw new Error('thumbnail renderer exploded');
        });

      try {
        const engine = mockSuccessfulEngine();
        const account = await createAccount();
        const sourceJobId = await requestConversion(account.accessToken, 'Editable Source');
        await runConversion(sourceJobId);
        const sourceCompleted = await processingJobs.findById(sourceJobId);
        const sourcePatternId = readStringRecord(sourceCompleted?.result, 'patternId');

        const clientPatternId = randomUUID();
        const grid = Buffer.from([1, 0, 1, 0]);
        const derivePayload = {
          patternId: clientPatternId,
          sourcePatternId,
          title: 'Edited Copy',
          width: 2,
          height: 2,
          palette: [{ dmcCode: '310', name: 'Black', rgbHex: '#000000' }],
          grid: grid.toString('base64'),
        };

        const first = await request(httpServer)
          .post('/v1/conversions/personal-patterns/derived')
          .set('Authorization', `Bearer ${account.accessToken}`)
          .send(derivePayload)
          .expect(201);
        expect(readStringRecord(first.body, 'id')).toBe(clientPatternId);
        expect(first.body).toMatchObject({ alreadyExists: false, title: 'Edited Copy', width: 2, height: 2 });
        expect(readRecord(first.body, 'thumbnailUrls')).toBeNull();

        const pattern = await dataSource
          .getRepository(PatternEntity)
          .findOneByOrFail({ id: clientPatternId });
        expect(pattern.status).toBe('available');
        expect(pattern.thumbnailRendererVersion).toBeNull();

        const derivedKeys = personalPatternObjectKeys(clientPatternId);
        const storage = app.get(LocalObjectStorage);
        expect(await storage.exists(derivedKeys.thumbnailBrowsing)).toBe(false);
        expect(await storage.exists(derivedKeys.thumbnailDetail)).toBe(false);

        const ownerList = await request(httpServer)
          .get('/v1/conversions/patterns')
          .set('Authorization', `Bearer ${account.accessToken}`)
          .expect(200);
        const ownerListBody: unknown = ownerList.body;
        if (!Array.isArray(ownerListBody)) {
          throw new Error('Personal Pattern list was not an array');
        }
        const derivedListItem: unknown = ownerListBody.find(
          (item) => readStringRecord(item, 'id') === clientPatternId,
        );
        if (derivedListItem === undefined) {
          throw new Error('Personal Pattern list did not contain the derived Pattern');
        }
        expect(readRecord(derivedListItem, 'thumbnailUrls')).toBeNull();

        const previewUrl = readStringRecord(derivedListItem, 'previewUrl');
        await request(httpServer)
          .get(previewUrl)
          .expect(200)
          .expect('Content-Type', /png/);

        engine.mockRestore();
      } finally {
        renderSpy.mockRestore();
        loggerSpy.mockRestore();
      }
    });

    it('rejects deriving from a Pattern the caller does not own', async () => {
      const engine = mockSuccessfulEngine();
      const owner = await createAccount();
      const stranger = await createAccount();
      const jobId = await requestConversion(owner.accessToken, 'Not Yours');
      await runConversion(jobId);
      const completed = await processingJobs.findById(jobId);
      const sourcePatternId = readStringRecord(completed?.result, 'patternId');

      await request(httpServer)
        .post('/v1/conversions/personal-patterns/derived')
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({
          patternId: randomUUID(),
          sourcePatternId,
          title: 'Stolen Copy',
          width: 2,
          height: 2,
          palette: [{ dmcCode: '310', name: 'Black', rgbHex: '#000000' }],
          grid: Buffer.from([1, 0, 1, 0]).toString('base64'),
        })
        .expect(404);
      engine.mockRestore();
    });

    it('rejects a malformed derive grid with 400', async () => {
      const engine = mockSuccessfulEngine();
      const account = await createAccount();
      const jobId = await requestConversion(account.accessToken, 'Malformed Target');
      await runConversion(jobId);
      const completed = await processingJobs.findById(jobId);
      const sourcePatternId = readStringRecord(completed?.result, 'patternId');

      await request(httpServer)
        .post('/v1/conversions/personal-patterns/derived')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          patternId: randomUUID(),
          sourcePatternId,
          title: 'Bad Grid',
          width: 2,
          height: 2,
          palette: [{ dmcCode: '310', name: 'Black', rgbHex: '#000000' }],
          grid: Buffer.from([1, 0, 1]).toString('base64'), // wrong length for 2x2
        })
        .expect(400);
      engine.mockRestore();
    });

    it('serves the canonical DMC color catalog to authenticated principals', async () => {
      const account = await createAccount();
      const response = await request(httpServer)
        .get('/v1/conversions/dmc-colors')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect((response.body as unknown[]).length).toBeGreaterThan(400);
      expect(response.body[0]).toMatchObject({
        dmcCode: expect.any(String),
        name: expect.any(String),
        rgbHex: expect.stringMatching(/^#[0-9A-F]{6}$/),
      });
    });

    it('issues an artifact-download grant for an owned Personal Pattern and serves the correct bytes', async () => {
      const engine = mockSuccessfulEngine();
      const account = await createAccount();
      const jobId = await requestConversion(account.accessToken, 'Artifact Test');
      await runConversion(jobId);
      const completed = await processingJobs.findById(jobId);
      const patternId = readStringRecord(completed?.result, 'patternId');

      const grant = await request(httpServer)
        .get(`/v1/conversions/personal-patterns/${patternId}/artifact-grant`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);

      expect(grant.body).toMatchObject({
        artifactUrl: expect.stringContaining(`/v1/personal-pattern-artifacts/${patternId}`),
        checksum: expect.any(String),
        byteLength: expect.any(Number),
        schemaVersion: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number),
        title: 'Artifact Test',
      });

      const artifactUrl = readStringRecord(grant.body, 'artifactUrl');
      const response = await request(httpServer)
        .get(artifactUrl)
        .expect(200)
        .expect('Content-Type', /octet-stream/);

      const hash = createHash('sha256').update(response.body).digest('hex');
      expect(hash).toBe(grant.body.checksum);

      // Other account gets 404
      const otherAccount = await createAccount();
      await request(httpServer)
        .get(`/v1/conversions/personal-patterns/${patternId}/artifact-grant`)
        .set('Authorization', `Bearer ${otherAccount.accessToken}`)
        .expect(404);

      engine.mockRestore();
    });
  });

  describe('session preparation', () => {
    const palette = [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: 'B5200', name: 'Snow White', rgbHex: '#FFFFFF' },
    ];

    async function seedPreparablePattern(title: string): Promise<{
      patternId: string;
      artifactBytes: Buffer;
      checksum: string;
    }> {
      const catalog = app.get(CatalogService);
      const grid = new Uint8Array(20 * 20).fill(1);
      const encoded = encodePatternArtifactV1({
        width: 20,
        height: 20,
        palette,
        grid,
      });
      const objectKey = `itest-prep/${title}/artifact.bin`;
      const storage = app.get(LocalObjectStorage);
      await storage.put(objectKey, encoded.bytes);
      const pattern = await catalog.upsertPattern({
        title,
        creatorName: 'ITest Prep Team',
        categoryCode: 'other',
        width: 20,
        height: 20,
        paletteSize: palette.length,
        artifactObjectKey: objectKey,
        artifactChecksum: encoded.checksum,
        artifactByteLength: encoded.byteLength,
        artifactSchemaVersion: encoded.schemaVersion,
        previewObjectKey: `itest-prep/${title}/preview.png`,
        unlockPriceTier: null,
        status: 'available',
        publishedAt: new Date('2026-07-01T00:00:00.000Z'),
        tagCodes: [],
      });
      return {
        patternId: pattern.id,
        artifactBytes: encoded.bytes,
        checksum: encoded.checksum,
      };
    }

    it('prepare is idempotent and race-safe on (identity, pattern)', async () => {
      const guest = await createGuestThroughApi(
        httpServer,
        randomUUID(),
        createCredentialSecret(),
      );
      const { patternId } = await seedPreparablePattern('ITest Prep Idem');

      const [a, b] = await Promise.all([
        request(httpServer)
          .post('/v1/sessions/prepare')
          .set('Authorization', `Bearer ${guest.accessToken}`)
          .send({ patternId })
          .expect(201),
        request(httpServer)
          .post('/v1/sessions/prepare')
          .set('Authorization', `Bearer ${guest.accessToken}`)
          .send({ patternId })
          .expect(201),
      ]);
      const idA = readStringRecord(a.body, 'sessionId');
      const idB = readStringRecord(b.body, 'sessionId');
      expect(idA).toBe(idB);

      const again = await request(httpServer)
        .post('/v1/sessions/prepare')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201);
      expect(readStringRecord(again.body, 'sessionId')).toBe(idA);
    });

    it('grant downloads exact artifact bytes and expired grants fail 403', async () => {
      const guest = await createGuestThroughApi(
        httpServer,
        randomUUID(),
        createCredentialSecret(),
      );
      const { patternId, artifactBytes, checksum } =
        await seedPreparablePattern('ITest Prep Grant');

      const prepared = await request(httpServer)
        .post('/v1/sessions/prepare')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201);
      const grant = readRecord(prepared.body, 'grant') as { url: string };

      const download = await request(httpServer).get(grant.url).expect(200);
      const downloaded = download.body as Buffer;
      expect(sha256Buffer(downloaded)).toBe(checksum);
      expect(Buffer.compare(downloaded, artifactBytes)).toBe(0);

      const sessions = app.get(SessionsService);
      const pastExp = Math.floor(Date.now() / 1000) - 10;
      const expiredSig = sessions.signGrant(patternId, pastExp);
      await request(httpServer)
        .get(`/v1/artifacts/${patternId}?exp=${pastExp}&sig=${expiredSig}`)
        .expect(403);

      const sessionId = readStringRecord(prepared.body, 'sessionId');
      const refreshed = await request(httpServer)
        .post(`/v1/sessions/${sessionId}/refresh-grant`)
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(201);
      const freshGrant = readRecord(refreshed.body, 'grant') as { url: string };
      await request(httpServer).get(freshGrant.url).expect(200);
    });

    it('cancellation deletes the session only when no device has progress', async () => {
      const guest = await createGuestThroughApi(
        httpServer,
        randomUUID(),
        createCredentialSecret(),
      );
      const { patternId } = await seedPreparablePattern('ITest Prep Cancel');

      const prepared = await request(httpServer)
        .post('/v1/sessions/prepare')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201);
      const sessionId = readStringRecord(prepared.body, 'sessionId');

      // No progress: cancel deletes, and repeat cancel is idempotent.
      await request(httpServer)
        .delete(`/v1/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(204);
      await request(httpServer)
        .delete(`/v1/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(204);

      // Recreate; with progress the session must survive cancellation.
      const second = await request(httpServer)
        .post('/v1/sessions/prepare')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201);
      const secondId = readStringRecord(second.body, 'sessionId');
      expect(secondId).not.toBe(sessionId);

      const sessions = app.get(SessionsService);
      await sessions.setProgressFlagInternal(secondId, true);
      await request(httpServer)
        .delete(`/v1/sessions/${secondId}`)
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(204);

      const third = await request(httpServer)
        .post('/v1/sessions/prepare')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201);
      expect(readStringRecord(third.body, 'sessionId')).toBe(secondId);
    });

    it('reconciler removes stale uploading rows and flags missing objects', async () => {
      const storage = app.get(LocalObjectStorage);
      const reconciler = app.get(StorageReconcilerService);

      const staleKey = 'itest-reconcile/stale-upload.bin';
      await storage.put(staleKey, Buffer.from('stale'));
      await dataSource.query(
        `INSERT INTO "storage"."object_registry" ("object_key", "checksum", "byte_length", "state", "created_at", "updated_at")
         VALUES ($1, 'x', 5, 'uploading', now() - interval '2 days', now() - interval '2 days')
         ON CONFLICT ("object_key") DO UPDATE SET "state" = 'uploading', "updated_at" = now() - interval '2 days'`,
        [staleKey],
      );

      const missingKey = 'itest-reconcile/missing-object.bin';
      await dataSource.query(
        `INSERT INTO "storage"."object_registry" ("object_key", "checksum", "byte_length", "state")
         VALUES ($1, 'y', 5, 'available')
         ON CONFLICT ("object_key") DO UPDATE SET "state" = 'available'`,
        [missingKey],
      );

      await reconciler.reconcileOnce(86400);

      const staleRows: unknown[] = await dataSource.query(
        'SELECT 1 FROM "storage"."object_registry" WHERE "object_key" = $1',
        [staleKey],
      );
      expect(staleRows).toHaveLength(0);
      expect(await storage.exists(staleKey)).toBe(false);

      const missingRows: { missing: boolean }[] = await dataSource.query(
        'SELECT "missing" FROM "storage"."object_registry" WHERE "object_key" = $1',
        [missingKey],
      );
      expect(missingRows[0]?.missing).toBe(true);
    });
  });

  describe('catalog', () => {
    const palette = [
      { dmcCode: '321', name: 'Christmas Red', rgbHex: '#C51E3A' },
      { dmcCode: 'B5200', name: 'Snow White', rgbHex: '#FFFFFF' },
    ];

    function catalogArtifactInput(width: number, height: number) {
      const grid = new Uint8Array(width * height).fill(1);
      return { width, height, palette, grid };
    }

    async function seedCatalogPattern(options: {
      title: string;
      creatorName: string;
      categoryCode: string;
      tagCodes: string[];
      status: 'available' | 'withdrawn' | 'removed';
      publishedAt: Date;
    }) {
      const catalog = app.get(CatalogService);
      const encoded = encodePatternArtifactV1(catalogArtifactInput(20, 20));
      return catalog.upsertPattern({
        title: options.title,
        creatorName: options.creatorName,
        categoryCode: options.categoryCode,
        width: 20,
        height: 20,
        paletteSize: palette.length,
        artifactObjectKey: `test/${options.title}/artifact.bin`,
        artifactChecksum: encoded.checksum,
        artifactByteLength: encoded.byteLength,
        artifactSchemaVersion: encoded.schemaVersion,
        previewObjectKey: `test/${options.title}/preview.png`,
        unlockPriceTier: null,
        status: options.status,
        publishedAt: options.publishedAt,
        tagCodes: options.tagCodes,
      });
    }

    it('serves catalog Thumbnails publicly only when the catalog Pattern stored them', async () => {
      const pattern = await seedCatalogPattern({
        title: 'ITest Catalog Thumbnail',
        creatorName: 'ITest Team',
        categoryCode: 'other',
        tagCodes: [],
        status: 'available',
        publishedAt: new Date('2026-07-01T00:00:00.000Z'),
      });
      const thumbnail = new PNG({ height: 1, width: 1 });
      thumbnail.data[0] = 32;
      thumbnail.data[1] = 120;
      thumbnail.data[2] = 180;
      thumbnail.data[3] = 255;
      const thumbnailBytes = PNG.sync.write(thumbnail);
      const keys = catalogPatternObjectKeys(pattern.id);
      const storage = app.get(LocalObjectStorage);
      await Promise.all([
        storage.put(keys.thumbnailBrowsing, thumbnailBytes),
        storage.put(keys.thumbnailDetail, thumbnailBytes),
        dataSource.getRepository(PatternEntity).update(
          { id: pattern.id },
          { thumbnailRendererVersion: PATTERN_THUMBNAIL_RENDERER_VERSION },
        ),
      ]);

      await request(httpServer)
        .get(`/v1/catalog-previews/${keys.thumbnailBrowsing}`)
        .expect(200)
        .expect('Content-Type', /image\/png/);
      await request(httpServer)
        .get(`/v1/catalog-previews/${keys.thumbnailDetail}`)
        .expect(200)
        .expect('Content-Type', /image\/png/);

      const patternWithoutThumbnail = await seedCatalogPattern({
        title: 'ITest Catalog Pattern Without Thumbnail',
        creatorName: 'ITest Team',
        categoryCode: 'other',
        tagCodes: [],
        status: 'available',
        publishedAt: new Date('2026-07-01T00:00:00.000Z'),
      });
      const keysWithoutThumbnail = catalogPatternObjectKeys(
        patternWithoutThumbnail.id,
      );
      await request(httpServer)
        .get(`/v1/catalog-previews/${keysWithoutThumbnail.thumbnailBrowsing}`)
        .expect(404);
      await request(httpServer)
        .get(`/v1/catalog-previews/${keysWithoutThumbnail.thumbnailDetail}`)
        .expect(404);

      const personalPatternId = randomUUID();
      const personalKeys = personalPatternObjectKeys(personalPatternId);
      await storage.put(personalKeys.thumbnailBrowsing, thumbnailBytes);
      await request(httpServer)
        .get(`/v1/catalog-previews/${personalKeys.thumbnailBrowsing}`)
        .expect(404);
    });

    it('upserts patterns idempotently and enforces the five-tag limit', async () => {
      const catalog = app.get(CatalogService);
      await catalog.upsertTagLabels('itest-cute', [
        { locale: 'en', label: 'ITest Cute' },
      ]);

      const first = await seedCatalogPattern({
        title: 'ITest Idempotent Fox',
        creatorName: 'ITest Team',
        categoryCode: 'animals',
        tagCodes: ['itest-cute'],
        status: 'available',
        publishedAt: new Date('2026-07-01T00:00:00.000Z'),
      });
      const second = await seedCatalogPattern({
        title: 'ITest Idempotent Fox',
        creatorName: 'ITest Team',
        categoryCode: 'animals',
        tagCodes: ['itest-cute'],
        status: 'available',
        publishedAt: new Date('2026-07-01T00:00:00.000Z'),
      });
      expect(second.id).toBe(first.id);

      await expect(
        seedCatalogPattern({
          title: 'ITest Too Many Tags',
          creatorName: 'ITest Team',
          categoryCode: 'animals',
          tagCodes: ['t1', 't2', 't3', 't4', 't5', 't6'],
          status: 'available',
          publishedAt: new Date('2026-07-01T00:00:00.000Z'),
        }),
      ).rejects.toThrow('at most 5 tags');
    });

    it('orders New by publication time, immutable under title edits, and excludes unavailable content', async () => {
      const catalog = app.get(CatalogService);
      await seedCatalogPattern({
        title: 'ITest Older Pattern',
        creatorName: 'ITest Team',
        categoryCode: 'fantasy',
        tagCodes: [],
        status: 'available',
        publishedAt: new Date('2026-06-01T00:00:00.000Z'),
      });
      await seedCatalogPattern({
        title: 'ITest Newer Pattern',
        creatorName: 'ITest Team',
        categoryCode: 'fantasy',
        tagCodes: [],
        status: 'available',
        publishedAt: new Date('2026-06-02T00:00:00.000Z'),
      });
      await seedCatalogPattern({
        title: 'ITest Withdrawn Pattern',
        creatorName: 'ITest Team',
        categoryCode: 'fantasy',
        tagCodes: [],
        status: 'withdrawn',
        publishedAt: new Date('2026-06-03T00:00:00.000Z'),
      });

      const firstPage = await request(httpServer)
        .get('/v1/catalog/new?limit=50')
        .expect(200);
      const titlesBefore = (
        firstPage.body as { items: { title: string; publishedAt: string }[] }
      ).items.map((item) => item.title);
      expect(titlesBefore).not.toContain('ITest Withdrawn Pattern');
      expect(titlesBefore.indexOf('ITest Newer Pattern')).toBeLessThan(
        titlesBefore.indexOf('ITest Older Pattern'),
      );

      // A metadata edit must not promote the pattern back into New.
      await seedCatalogPattern({
        title: 'ITest Older Pattern',
        creatorName: 'ITest Team',
        categoryCode: 'fantasy',
        tagCodes: [],
        status: 'available',
        publishedAt: new Date('2026-06-01T00:00:00.000Z'),
      });
      const afterEdit = await request(httpServer)
        .get('/v1/catalog/new?limit=50')
        .expect(200);
      const titlesAfter = (
        afterEdit.body as { items: { title: string }[] }
      ).items.map((item) => item.title);
      expect(titlesAfter.indexOf('ITest Newer Pattern')).toBeLessThan(
        titlesAfter.indexOf('ITest Older Pattern'),
      );

      const catalogCategories = await request(httpServer)
        .get('/v1/catalog/categories')
        .expect(200);
      const fantasy = (
        catalogCategories.body as { code: string; count: number }[]
      ).find((category) => category.code === 'fantasy');
      // Only the two available fantasy patterns count.
      expect(fantasy?.count).toBeGreaterThanOrEqual(2);
      const withdrawnDetail = await catalog.searchPatterns(
        'ITest Withdrawn Pattern',
        10,
        'en',
      );
      expect(withdrawnDetail).toHaveLength(0);
    });

    it('serves ordered staff picks and searches title, creator, and tag labels', async () => {
      const catalog = app.get(CatalogService);
      await catalog.upsertTagLabels('itest-woodland', [
        { locale: 'en', label: 'ITest Woodland' },
      ]);
      await seedCatalogPattern({
        title: 'ITest Pick Alpha',
        creatorName: 'ITest Curator',
        categoryCode: 'animals',
        tagCodes: ['itest-woodland'],
        status: 'available',
        publishedAt: new Date('2026-06-10T00:00:00.000Z'),
      });
      await seedCatalogPattern({
        title: 'ITest Pick Beta',
        creatorName: 'ITest Curator',
        categoryCode: 'animals',
        tagCodes: [],
        status: 'available',
        publishedAt: new Date('2026-06-11T00:00:00.000Z'),
      });
      await catalog.setStaffPick('ITest Pick Beta', 'ITest Curator', 101);
      await catalog.setStaffPick('ITest Pick Alpha', 'ITest Curator', 102);

      const picksResponse = await request(httpServer)
        .get('/v1/catalog/staff-picks')
        .expect(200);
      const pickTitles = (
        picksResponse.body as { title: string }[]
      ).map((item) => item.title);
      expect(pickTitles.indexOf('ITest Pick Beta')).toBeLessThan(
        pickTitles.indexOf('ITest Pick Alpha'),
      );

      const byTitle = await request(httpServer)
        .get('/v1/catalog/search?q=Pick Alpha&locale=en&limit=10')
        .expect(200);
      expect((byTitle.body as { title: string }[])[0]?.title).toBe(
        'ITest Pick Alpha',
      );

      const byCreator = await request(httpServer)
        .get('/v1/catalog/search?q=ITest Curator&locale=en&limit=10')
        .expect(200);
      expect((byCreator.body as { title: string }[]).length).toBeGreaterThanOrEqual(
        2,
      );

      const byTagLabel = await request(httpServer)
        .get('/v1/catalog/search?q=Woodland&locale=en&limit=10')
        .expect(200);
      expect(
        (byTagLabel.body as { title: string }[]).map((item) => item.title),
      ).toContain('ITest Pick Alpha');
    });
  });

  describe('progress sync', () => {
    const palette = [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: 'B5200', name: 'Snow White', rgbHex: '#FFFFFF' },
    ];

    interface Ack {
      opId: string;
      status: 'applied' | 'duplicate' | 'superseded';
    }
    interface ForeignOp {
      opId: string;
      deviceId: string;
      deviceSeq: number;
      cellIndex: number;
      desiredState: 'completed' | 'incomplete';
      resolvedState: 'completed' | 'incomplete';
      baseRevision: number;
      serverRevision: number;
      effective: boolean;
    }
    interface SyncResult {
      revision: number;
      terminalCompleted: boolean;
      acknowledgements: Ack[];
      operations: ForeignOp[];
    }
    interface IncomingOp {
      opId: string;
      deviceSeq: number;
      cellIndex: number;
      desiredState: 'completed' | 'incomplete';
      baseRevision: number;
    }

    async function createAccount(): Promise<{
      accountId: string;
      accessToken: string;
    }> {
      const email = `progress-${randomUUID()}@example.test`;
      await request(httpServer)
        .post('/v1/auth/email/request')
        .send({ email })
        .expect(202);
      const code = await dispatchAndReadEmailOtp(email);
      const verified = await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ email, code })
        .expect(200);
      return {
        accountId: readStringRecord(verified.body, 'accountId'),
        accessToken: readStringRecord(verified.body, 'accessToken'),
      };
    }

    async function seedPattern(
      title: string,
      width: number,
      height: number,
    ): Promise<string> {
      const catalog = app.get(CatalogService);
      const grid = new Uint8Array(width * height).fill(1);
      const encoded = encodePatternArtifactV1({ width, height, palette, grid });
      const objectKey = `itest-progress/${title}/artifact.bin`;
      await app.get(LocalObjectStorage).put(objectKey, encoded.bytes);
      const pattern = await catalog.upsertPattern({
        title,
        creatorName: 'ITest Progress Team',
        categoryCode: 'other',
        width,
        height,
        paletteSize: palette.length,
        artifactObjectKey: objectKey,
        artifactChecksum: encoded.checksum,
        artifactByteLength: encoded.byteLength,
        artifactSchemaVersion: encoded.schemaVersion,
        previewObjectKey: `itest-progress/${title}/preview.png`,
        unlockPriceTier: null,
        status: 'available',
        publishedAt: new Date('2026-07-01T00:00:00.000Z'),
        tagCodes: [],
      });
      return pattern.id;
    }

    async function prepareSession(
      accessToken: string,
      patternId: string,
    ): Promise<string> {
      const prepared = await request(httpServer)
        .post('/v1/sessions/prepare')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ patternId })
        .expect(201);
      return readStringRecord(prepared.body, 'sessionId');
    }

    async function postSync(
      accessToken: string,
      sessionId: string,
      deviceId: string,
      sinceRevision: number,
      operations: IncomingOp[],
    ): Promise<SyncResult> {
      const response = await request(httpServer)
        .post(`/v1/sessions/${sessionId}/progress/sync`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ deviceId, sinceRevision, operations })
        .expect(200);
      return response.body as SyncResult;
    }

    async function readCellState(
      sessionId: string,
      cellIndex: number,
    ): Promise<'completed' | 'incomplete' | null> {
      const rows = await dataSource.query<
        { state: 'completed' | 'incomplete' }[]
      >(
        `SELECT state FROM sessions.session_cell_state
         WHERE session_id = $1 AND cell_index = $2`,
        [sessionId, cellIndex],
      );
      return rows[0]?.state ?? null;
    }

    it('converges two devices; a causally later Undo wins over an earlier stitch', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('Converge', 2, 2);
      const sessionId = await prepareSession(account.accessToken, patternId);
      const devA = randomUUID();
      const devB = randomUUID();

      const stitch = await postSync(account.accessToken, sessionId, devA, 0, [
        {
          opId: randomUUID(),
          deviceSeq: 1,
          cellIndex: 0,
          desiredState: 'completed',
          baseRevision: 0,
        },
      ]);
      expect(stitch.acknowledgements[0].status).toBe('applied');
      expect(stitch.revision).toBe(1);
      expect(await readCellState(sessionId, 0)).toBe('completed');

      // Device B pulls the stitch, then issues a causally-later Undo.
      const pull = await postSync(account.accessToken, sessionId, devB, 0, []);
      expect(pull.operations.map((operation) => operation.cellIndex)).toContain(0);
      expect(pull.revision).toBe(1);

      const undo = await postSync(
        account.accessToken,
        sessionId,
        devB,
        pull.revision,
        [
          {
            opId: randomUUID(),
            deviceSeq: 1,
            cellIndex: 0,
            desiredState: 'incomplete',
            baseRevision: 1,
          },
        ],
      );
      expect(undo.acknowledgements[0].status).toBe('applied');
      expect(await readCellState(sessionId, 0)).toBe('incomplete');

      // Device A converges by pulling the foreign Undo.
      const converge = await postSync(account.accessToken, sessionId, devA, 1, []);
      expect(
        converge.operations.some(
          (operation) =>
            operation.cellIndex === 0 && operation.desiredState === 'incomplete',
        ),
      ).toBe(true);
    });

    it('resolves genuinely concurrent completed-vs-incomplete to completed; unrelated cells merge independently', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('Concurrent', 4, 4);
      const sessionId = await prepareSession(account.accessToken, patternId);
      const devA = randomUUID();
      const devB = randomUUID();

      // A completes cell 5.
      await postSync(account.accessToken, sessionId, devA, 0, [
        {
          opId: randomUUID(),
          deviceSeq: 1,
          cellIndex: 5,
          desiredState: 'completed',
          baseRevision: 0,
        },
      ]);
      // B, unaware (baseRevision 0), concurrently marks cell 5 incomplete.
      const concurrent = await postSync(account.accessToken, sessionId, devB, 0, [
        {
          opId: randomUUID(),
          deviceSeq: 1,
          cellIndex: 5,
          desiredState: 'incomplete',
          baseRevision: 0,
        },
      ]);
      expect(concurrent.acknowledgements[0].status).toBe('applied');
      expect(await readCellState(sessionId, 5)).toBe('completed');
      // The client's own concurrent op resolves to completed authoritatively, so
      // the pull hands back resolvedState=completed for cell 5 to converge it.
      const cell5Resolved = concurrent.operations
        .filter((operation) => operation.cellIndex === 5)
        .sort((left, right) => left.serverRevision - right.serverRevision)
        .at(-1);
      expect(cell5Resolved?.resolvedState).toBe('completed');

      // Unrelated cells merge independently.
      await postSync(account.accessToken, sessionId, devA, 0, [
        {
          opId: randomUUID(),
          deviceSeq: 2,
          cellIndex: 10,
          desiredState: 'completed',
          baseRevision: 0,
        },
      ]);
      await postSync(account.accessToken, sessionId, devB, 0, [
        {
          opId: randomUUID(),
          deviceSeq: 2,
          cellIndex: 11,
          desiredState: 'completed',
          baseRevision: 0,
        },
      ]);
      expect(await readCellState(sessionId, 10)).toBe('completed');
      expect(await readCellState(sessionId, 11)).toBe('completed');
    });

    it('is idempotent: re-uploading an acknowledged batch is a no-op', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('Idempotent', 2, 2);
      const sessionId = await prepareSession(account.accessToken, patternId);
      const devA = randomUUID();
      const batch: IncomingOp[] = [
        {
          opId: randomUUID(),
          deviceSeq: 1,
          cellIndex: 0,
          desiredState: 'completed',
          baseRevision: 0,
        },
      ];

      const first = await postSync(account.accessToken, sessionId, devA, 0, batch);
      expect(first.acknowledgements[0].status).toBe('applied');

      const replay = await postSync(account.accessToken, sessionId, devA, 0, batch);
      expect(replay.acknowledgements[0].status).toBe('duplicate');
      expect(replay.revision).toBe(first.revision);
      expect(await readCellState(sessionId, 0)).toBe('completed');
    });

    it('accepts terminal completion and supersedes late operations without reopening', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('Terminal', 2, 2);
      const sessionId = await prepareSession(account.accessToken, patternId);
      const devA = randomUUID();

      const ops: IncomingOp[] = [0, 1, 2, 3].map((cellIndex, index) => ({
        opId: randomUUID(),
        deviceSeq: index + 1,
        cellIndex,
        desiredState: 'completed',
        baseRevision: 0,
      }));
      const applied = await postSync(account.accessToken, sessionId, devA, 0, ops);
      expect(applied.acknowledgements.every((ack) => ack.status === 'applied')).toBe(
        true,
      );

      const completed = await request(httpServer)
        .post(`/v1/sessions/${sessionId}/progress/complete`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ deviceId: devA })
        .expect(200);
      expect((completed.body as { terminalCompleted: boolean }).terminalCompleted).toBe(
        true,
      );

      const late = await postSync(account.accessToken, sessionId, devA, applied.revision, [
        {
          opId: randomUUID(),
          deviceSeq: 5,
          cellIndex: 0,
          desiredState: 'incomplete',
          baseRevision: 999,
        },
      ]);
      expect(late.acknowledgements[0].status).toBe('superseded');
      expect(late.terminalCompleted).toBe(true);
      expect(await readCellState(sessionId, 0)).toBe('completed');
    });

    it('rebases a device offline past compaction without double-applying its replayed operations', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('Compaction', 2, 2);
      const sessionId = await prepareSession(account.accessToken, patternId);
      const devA = randomUUID();

      const ops: IncomingOp[] = [0, 1, 2, 3].map((cellIndex, index) => ({
        opId: randomUUID(),
        deviceSeq: index + 1,
        cellIndex,
        desiredState: 'completed',
        baseRevision: 0,
      }));
      const applied = await postSync(account.accessToken, sessionId, devA, 0, ops);

      await app.get(ProgressCheckpointService).compactOnce(sessionId);
      const remaining = await dataSource.query<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM sessions.progress_operations
         WHERE session_id = $1`,
        [sessionId],
      );
      expect(remaining[0].n).toBe(0);

      // The offline device replays its already-applied ops verbatim.
      const replay = await postSync(account.accessToken, sessionId, devA, 0, ops);
      expect(replay.acknowledgements.every((ack) => ack.status === 'duplicate')).toBe(
        true,
      );
      expect(replay.revision).toBe(applied.revision);
      for (const cellIndex of [0, 1, 2, 3]) {
        expect(await readCellState(sessionId, cellIndex)).toBe('completed');
      }

      // The folded checkpoint carries the completed cells for a rebasing device.
      const checkpoint = await request(httpServer)
        .get(`/v1/sessions/${sessionId}/progress/checkpoint`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      const packed = Buffer.from(
        readStringRecord(checkpoint.body, 'packedBitmapBase64'),
        'base64',
      );
      expect(packed[0] & 0b1111).toBe(0b1111);
    });

    async function syncAllCellsAndComplete(
      accessToken: string,
      sessionId: string,
      deviceId: string,
      cellCount: number,
    ): Promise<{
      firstCompletionReward?: { amount: number; balance: number };
      terminalCompleted: boolean;
    }> {
      const ops: IncomingOp[] = Array.from(
        { length: cellCount },
        (_unused, cellIndex) => ({
          opId: randomUUID(),
          deviceSeq: cellIndex + 1,
          cellIndex,
          desiredState: 'completed',
          baseRevision: 0,
        }),
      );
      await postSync(accessToken, sessionId, deviceId, 0, ops);
      const completed = await request(httpServer)
        .post(`/v1/sessions/${sessionId}/progress/complete`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ deviceId })
        .expect(200);
      return completed.body as {
        firstCompletionReward?: { amount: number; balance: number };
        terminalCompleted: boolean;
      };
    }

    it('mints the First Completion Reward once for a catalog pattern; a Replay Session does not repeat it', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('FirstCompletion', 2, 2); // 4 cells → Small
      const ledger = app.get(CoinLedgerRepository);
      const principal = { type: 'account', id: account.accountId } as const;

      const first = await prepareSession(account.accessToken, patternId);
      const firstResult = await syncAllCellsAndComplete(
        account.accessToken,
        first,
        randomUUID(),
        4,
      );
      expect(firstResult.firstCompletionReward).toEqual({
        amount: 25,
        balance: 25,
      });
      expect(await ledger.getBalance(principal)).toBe(25);

      // A Replay Session is a fresh active session on the same Pattern; it must
      // never re-mint the First Completion Reward (ADR-0011).
      const replay = await prepareSession(account.accessToken, patternId);
      expect(replay).not.toBe(first);
      const replayResult = await syncAllCellsAndComplete(
        account.accessToken,
        replay,
        randomUUID(),
        4,
      );
      expect(replayResult.terminalCompleted).toBe(true);
      expect(replayResult.firstCompletionReward).toBeUndefined();
      expect(await ledger.getBalance(principal)).toBe(25);
    });

    it('never mints the First Completion Reward for a Personal Pattern', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('PersonalNoReward', 2, 2);
      // Personal Patterns are unlimited and never mint the reward (ADR-0011).
      await dataSource.query(
        `UPDATE catalog.patterns
         SET visibility = 'personal', owner_account_id = $1
         WHERE id = $2`,
        [account.accountId, patternId],
      );
      const ledger = app.get(CoinLedgerRepository);
      const principal = { type: 'account', id: account.accountId } as const;

      const sessionId = await prepareSession(account.accessToken, patternId);
      const result = await syncAllCellsAndComplete(
        account.accessToken,
        sessionId,
        randomUUID(),
        4,
      );
      expect(result.terminalCompleted).toBe(true);
      expect(result.firstCompletionReward).toBeUndefined();
      expect(await ledger.getBalance(principal)).toBe(0);
    });
  });

  describe('rewarded ad coin economy', () => {
    async function newGuest(): Promise<GuestSessionFixture> {
      return createGuestThroughApi(
        httpServer,
        randomUUID(),
        createCredentialSecret(),
      );
    }

    it('grants a verified rewarded ad exactly once per transaction id', async () => {
      const guest = await newGuest();
      const ledger = app.get(CoinLedgerRepository);
      const principal = { type: 'guest', id: guest.guestId } as const;
      const rewardDay = utcRewardDay();

      const first = await ledger.grantAdReward(
        principal,
        rewardDay,
        'ad:txn-1',
      );
      expect(first).toMatchObject({
        granted: true,
        amount: 10,
        balance: 10,
        adsCompleted: 1,
        coinsConsumed: 10,
        replayed: false,
      });

      // A replayed AdMob callback with the same transaction id must not
      // double-grant (ADR-0033 idempotency).
      const replay = await ledger.grantAdReward(
        principal,
        rewardDay,
        'ad:txn-1',
      );
      expect(replay.replayed).toBe(true);
      expect(replay.balance).toBe(10);
      expect(await ledger.getBalance(principal)).toBe(10);
    });

    it('caps the Reward Day at 30 coin across three ads and grants nothing after', async () => {
      const guest = await newGuest();
      const ledger = app.get(CoinLedgerRepository);
      const principal = { type: 'guest', id: guest.guestId } as const;
      const rewardDay = utcRewardDay();

      await ledger.grantAdReward(principal, rewardDay, 'ad:a');
      await ledger.grantAdReward(principal, rewardDay, 'ad:b');
      const third = await ledger.grantAdReward(principal, rewardDay, 'ad:c');
      expect(third).toMatchObject({
        granted: true,
        balance: 30,
        adsCompleted: 3,
        coinsConsumed: 30,
      });

      // Fourth ad of the day: verified, recorded for idempotency, but grants
      // nothing and consumes nothing.
      const fourth = await ledger.grantAdReward(principal, rewardDay, 'ad:d');
      expect(fourth).toMatchObject({
        granted: false,
        amount: 0,
        balance: 30,
      });
      expect(await ledger.getBalance(principal)).toBe(30);
    });

    it('exposes balance and reward-day status to the authenticated player', async () => {
      const guest = await newGuest();
      const ledger = app.get(CoinLedgerRepository);
      const principal = { type: 'guest', id: guest.guestId } as const;
      await ledger.grantAdReward(principal, utcRewardDay(), 'ad:read-1');

      const balance = await request(httpServer)
        .get('/v1/economy/balance')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(200);
      expect(balance.body).toEqual({ balance: 10 });

      const rewardDay = await request(httpServer)
        .get('/v1/economy/reward-day')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(200);
      expect(rewardDay.body).toMatchObject({
        balance: 10,
        adsRemaining: 2,
        coinsRemaining: 20,
      });
      expect(typeof readStringRecord(rewardDay.body, 'resetsAt')).toBe('string');
    });

    it('requires authentication for coin reads', async () => {
      await request(httpServer).get('/v1/economy/balance').expect(401);
      await request(httpServer).get('/v1/economy/reward-day').expect(401);
    });

    it('requires authentication for creating ad attempts', async () => {
      await request(httpServer).post('/v1/economy/ad-attempts').expect(401);
    });

    it('creates an ad attempt nonce when pool has capacity', async () => {
      const guest = await newGuest();
      const res = await request(httpServer)
        .post('/v1/economy/ad-attempts')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(201);

      expect(res.body.nonce).toBeDefined();
      expect(typeof res.body.nonce).toBe('string');
      expect(res.body.expiresAt).toBeDefined();

      const rows = await dataSource.query(
        `SELECT principal_type, principal_id, placement FROM economy.ad_attempts WHERE nonce = $1`,
        [res.body.nonce],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        principal_type: 'guest',
        principal_id: guest.guestId,
        placement: 'rewarded_ad',
      });
    });

    it('rejects ad attempts when daily limits are exhausted', async () => {
      const guest = await newGuest();
      const ledger = app.get(CoinLedgerRepository);
      const principal = { type: 'guest', id: guest.guestId } as const;
      const rewardDay = utcRewardDay();

      await ledger.grantAdReward(principal, rewardDay, 'ad:exhaust-1');
      await ledger.grantAdReward(principal, rewardDay, 'ad:exhaust-2');
      await ledger.grantAdReward(principal, rewardDay, 'ad:exhaust-3');

      await request(httpServer)
        .post('/v1/economy/ad-attempts')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(409);
    });
  });


  describe('pattern unlock coin spend', () => {
    const unlockPalette = [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: 'B5200', name: 'Snow White', rgbHex: '#FFFFFF' },
    ];

    async function newGuest(): Promise<GuestSessionFixture> {
      return createGuestThroughApi(
        httpServer,
        randomUUID(),
        createCredentialSecret(),
      );
    }

    async function seedPaidPattern(
      title: string,
      tier: 'small' | 'medium' | 'large' | null,
      width: number,
      height: number,
    ): Promise<string> {
      const catalog = app.get(CatalogService);
      const grid = new Uint8Array(width * height).fill(1);
      const encoded = encodePatternArtifactV1({
        width,
        height,
        palette: unlockPalette,
        grid,
      });
      const objectKey = `itest-unlock/${title}/artifact.bin`;
      await app.get(LocalObjectStorage).put(objectKey, encoded.bytes);
      const pattern = await catalog.upsertPattern({
        title,
        creatorName: 'ITest Unlock Team',
        categoryCode: 'other',
        width,
        height,
        paletteSize: unlockPalette.length,
        artifactObjectKey: objectKey,
        artifactChecksum: encoded.checksum,
        artifactByteLength: encoded.byteLength,
        artifactSchemaVersion: encoded.schemaVersion,
        previewObjectKey: `itest-unlock/${title}/preview.png`,
        unlockPriceTier: tier,
        status: 'available',
        publishedAt: new Date('2026-07-01T00:00:00.000Z'),
        tagCodes: [],
      });
      return pattern.id;
    }

    async function seedGuestBalance(
      guestId: string,
      balance: number,
    ): Promise<void> {
      await dataSource.query(
        `INSERT INTO economy.coin_balances (principal_type, principal_id, balance)
         VALUES ('guest', $1, $2)
         ON CONFLICT ON CONSTRAINT "PK_coin_balances"
           DO UPDATE SET balance = EXCLUDED.balance, updated_at = now()`,
        [guestId, balance],
      );
    }

    async function countUnlockLedgerEntries(guestId: string): Promise<number> {
      const rows = await dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*) AS count FROM economy.coin_ledger_entries
         WHERE principal_type = 'guest' AND principal_id = $1
           AND reason = 'unlock_spend'`,
        [guestId],
      );
      return Number(rows[0].count);
    }

    it('unlocks a paid Pattern once, debits the tier price, and replays idempotently', async () => {
      const guest = await newGuest();
      const patternId = await seedPaidPattern('Unlock Small', 'small', 5, 5);
      await seedGuestBalance(guest.guestId, 100);

      // Small tier = 75 coin (ADR-0011); 100 - 75 = 25.
      const first = await request(httpServer)
        .post('/v1/economy/unlocks')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201);
      expect(first.body).toEqual({
        patternId,
        alreadyUnlocked: false,
        balance: 25,
      });

      const owned = await request(httpServer)
        .get('/v1/economy/unlocks')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(200);
      expect(owned.body).toEqual({ patternIds: [patternId] });

      const balance = await request(httpServer)
        .get('/v1/economy/balance')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(200);
      expect(balance.body).toEqual({ balance: 25 });

      // Replay: permanent entitlement, no second charge.
      const replay = await request(httpServer)
        .post('/v1/economy/unlocks')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201);
      expect(replay.body).toEqual({
        patternId,
        alreadyUnlocked: true,
        balance: 25,
      });
      expect(await countUnlockLedgerEntries(guest.guestId)).toBe(1);
    });

    it('rejects a paid unlock with insufficient balance (409) and mutates nothing', async () => {
      const guest = await newGuest();
      const patternId = await seedPaidPattern('Unlock Large', 'large', 10, 10);
      await seedGuestBalance(guest.guestId, 50);

      const rejected = await request(httpServer)
        .post('/v1/economy/unlocks')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(409);
      expect(rejected.body).toMatchObject({
        code: 'insufficient_balance',
        price: 300,
        balance: 50,
      });

      const owned = await request(httpServer)
        .get('/v1/economy/unlocks')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(200);
      expect(owned.body).toEqual({ patternIds: [] });

      const balance = await request(httpServer)
        .get('/v1/economy/balance')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(200);
      expect(balance.body).toEqual({ balance: 50 });
      expect(await countUnlockLedgerEntries(guest.guestId)).toBe(0);
    });

    it('rejects unlocking a free Pattern with 400 pattern_free', async () => {
      const guest = await newGuest();
      const patternId = await seedPaidPattern('Unlock Free', null, 3, 3);
      await seedGuestBalance(guest.guestId, 500);

      const rejected = await request(httpServer)
        .post('/v1/economy/unlocks')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(400);
      expect(rejected.body).toMatchObject({ code: 'pattern_free' });
    });

    it('Session Preparation rejects a locked Pattern until it is unlocked', async () => {
      const guest = await newGuest();
      const patternId = await seedPaidPattern('Gate Small', 'small', 4, 4);

      const locked = await request(httpServer)
        .post('/v1/sessions/prepare')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(403);
      expect(locked.body).toMatchObject({
        code: 'unlock_required',
        patternId,
        price: 75,
      });

      await seedGuestBalance(guest.guestId, 75);
      await request(httpServer)
        .post('/v1/economy/unlocks')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201);

      const prepared = await request(httpServer)
        .post('/v1/sessions/prepare')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201);
      expect(readStringRecord(prepared.body, 'sessionId')).toEqual(
        expect.any(String),
      );
    });

    it('unlock survives session cancellation and replay with no re-charge', async () => {
      const guest = await newGuest();
      const patternId = await seedPaidPattern('Unlock Permanence', 'small', 4, 4);
      await seedGuestBalance(guest.guestId, 75);

      // Unlock once: balance debited to 0.
      await request(httpServer)
        .post('/v1/economy/unlocks')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201);

      const firstPrepare = await request(httpServer)
        .post('/v1/sessions/prepare')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201);
      const firstSessionId = readStringRecord(firstPrepare.body, 'sessionId');

      // Cancel/delete the session (no progress recorded yet).
      await request(httpServer)
        .delete(`/v1/sessions/${firstSessionId}`)
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(204);

      // Replay: prepare the same Pattern again. The unlock must still be
      // honored (no 403 unlock_required) even though the session was deleted.
      const secondPrepare = await request(httpServer)
        .post('/v1/sessions/prepare')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201);
      expect(readStringRecord(secondPrepare.body, 'sessionId')).toEqual(
        expect.any(String),
      );

      // The entitlement is still listed and the balance was never re-charged.
      const owned = await request(httpServer)
        .get('/v1/economy/unlocks')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(200);
      expect(owned.body).toEqual({ patternIds: [patternId] });

      const balance = await request(httpServer)
        .get('/v1/economy/balance')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(200);
      expect(balance.body).toEqual({ balance: 0 });

      // A repeat unlock call after cancellation/replay is still idempotent:
      // still exactly one ledger debit total for this guest.
      const repeatUnlock = await request(httpServer)
        .post('/v1/economy/unlocks')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201);
      expect(repeatUnlock.body).toEqual({
        patternId,
        alreadyUnlocked: true,
        balance: 0,
      });
      expect(await countUnlockLedgerEntries(guest.guestId)).toBe(1);
    });
  });

  describe('Daily Tasks', () => {
    const dailyPalette = [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: 'B5200', name: 'Snow White', rgbHex: '#FFFFFF' },
      { dmcCode: '321', name: 'Red', rgbHex: '#FF0000' },
      { dmcCode: '333', name: 'Blue', rgbHex: '#0000FF' },
    ];

    async function createAccount(): Promise<{
      accountId: string;
      accessToken: string;
    }> {
      const email = `daily-${randomUUID()}@example.test`;
      await request(httpServer)
        .post('/v1/auth/email/request')
        .send({ email })
        .expect(202);
      const code = await dispatchAndReadEmailOtp(email);
      const verified = await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ email, code })
        .expect(200);
      return {
        accountId: readStringRecord(verified.body, 'accountId'),
        accessToken: readStringRecord(verified.body, 'accessToken'),
      };
    }

    async function seedPattern(
      title: string,
      width: number,
      height: number,
    ): Promise<string> {
      const catalog = app.get(CatalogService);
      const grid = new Uint8Array(width * height).fill(1);
      const encoded = encodePatternArtifactV1({ width, height, palette: dailyPalette, grid });
      const objectKey = `itest-daily/${title}/artifact.bin`;
      await app.get(LocalObjectStorage).put(objectKey, encoded.bytes);
      const pattern = await catalog.upsertPattern({
        title,
        creatorName: 'ITest Daily Team',
        categoryCode: 'other',
        width,
        height,
        paletteSize: dailyPalette.length,
        artifactObjectKey: objectKey,
        artifactChecksum: encoded.checksum,
        artifactByteLength: encoded.byteLength,
        artifactSchemaVersion: encoded.schemaVersion,
        previewObjectKey: `itest-daily/${title}/preview.png`,
        unlockPriceTier: null,
        status: 'available',
        publishedAt: new Date('2026-07-01T00:00:00.000Z'),
        tagCodes: [],
      });
      return pattern.id;
    }

    async function prepareSession(
      accessToken: string,
      patternId: string,
    ): Promise<string> {
      const prepared = await request(httpServer)
        .post('/v1/sessions/prepare')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ patternId })
        .expect(201);
      return readStringRecord(prepared.body, 'sessionId');
    }

    it('processes 100 stitch actions in one session and grants cells_100', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('Daily 100 cells', 10, 10);
      const sessionId = await prepareSession(account.accessToken, patternId);

      const events = [];
      for (let i = 0; i < 100; i++) {
        events.push({
          eventId: randomUUID(),
          kind: 'stitch_action',
          sessionId,
          dmcCode: '310',
          clientSeq: i,
          occurredAt: new Date(Date.now() - (100 - i) * 1000).toISOString(),
        });
      }

      const response = await request(httpServer)
        .post('/v1/economy/daily-tasks/events')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ events })
        .expect(201);

      expect(response.body.balance).toBe(10);
      const task = response.body.tasks.find((t: any) => t.key === 'cells_100');
      expect(task).toMatchObject({
        progress: 100,
        completed: true,
        granted: true,
      });

      const replay = await request(httpServer)
        .post('/v1/economy/daily-tasks/events')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ events })
        .expect(201);

      expect(replay.body.balance).toBe(10);
    });

    it('processes 10 stitch actions in 3 distinct colors (30 events) and grants three_colors_10', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('Daily 3 colors', 10, 10);
      const sessionId = await prepareSession(account.accessToken, patternId);

      const events = [];
      const colors = ['310', 'B5200', '321'];
      let seq = 0;
      for (const color of colors) {
        for (let i = 0; i < 10; i++) {
          events.push({
            eventId: randomUUID(),
            kind: 'stitch_action',
            sessionId,
            dmcCode: color,
            clientSeq: seq++,
            occurredAt: new Date(Date.now() - (30 - seq) * 1000).toISOString(),
          });
        }
      }

      const response = await request(httpServer)
        .post('/v1/economy/daily-tasks/events')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ events })
        .expect(201);

      expect(response.body.balance).toBe(10);

      const threeColorsTask = response.body.tasks.find((t: any) => t.key === 'three_colors_10');
      expect(threeColorsTask).toMatchObject({
        progress: 3,
        completed: true,
        granted: true,
      });

      const cellsTask = response.body.tasks.find((t: any) => t.key === 'cells_100');
      expect(cellsTask).toMatchObject({
        progress: 30,
        completed: false,
        granted: false,
      });
    });

    it('processes one color_completion and grants color_completion task', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('Daily color completion', 5, 5);
      const sessionId = await prepareSession(account.accessToken, patternId);

      const events = [
        {
          eventId: randomUUID(),
          kind: 'color_completion',
          sessionId,
          dmcCode: '310',
          clientSeq: 0,
          occurredAt: new Date().toISOString(),
        },
      ];

      const response = await request(httpServer)
        .post('/v1/economy/daily-tasks/events')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ events })
        .expect(201);

      expect(response.body.balance).toBe(10);
      const task = response.body.tasks.find((t: any) => t.key === 'color_completion');
      expect(task).toMatchObject({
        progress: 1,
        completed: true,
        granted: true,
      });
    });

    it('grants Daily Task rewards to a Guest Ledger from that guest\'s prepared session', async () => {
      const guest = await createGuestThroughApi(
        httpServer,
        randomUUID(),
        createCredentialSecret(),
      );
      const patternId = await seedPattern('Guest Daily Task', 2, 2);
      const sessionId = await prepareSession(guest.accessToken, patternId);

      const response = await request(httpServer)
        .post('/v1/economy/daily-tasks/events')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({
          events: [{
            eventId: randomUUID(),
            kind: 'color_completion',
            sessionId,
            dmcCode: '310',
            clientSeq: 1,
            occurredAt: new Date().toISOString(),
          }],
        })
        .expect(201);

      expect(response.body.balance).toBe(10);
      expect(response.body.tasks.find((task: { key: string }) => task.key === 'color_completion')).toMatchObject({
        progress: 1,
        completed: true,
        granted: true,
      });

      const board = await request(httpServer)
        .get('/v1/economy/daily-tasks')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .expect(200);
      expect(board.body.balance).toBe(10);
    });

    it('skips events referencing a sessionId NOT owned by the account', async () => {
      const account1 = await createAccount();
      const account2 = await createAccount();
      const patternId = await seedPattern('Daily Session Ownership', 5, 5);
      const sessionId1 = await prepareSession(account1.accessToken, patternId);

      const events = [
        {
          eventId: randomUUID(),
          kind: 'color_completion',
          sessionId: sessionId1,
          dmcCode: '310',
          clientSeq: 0,
          occurredAt: new Date().toISOString(),
        },
      ];

      const response = await request(httpServer)
        .post('/v1/economy/daily-tasks/events')
        .set('Authorization', `Bearer ${account2.accessToken}`)
        .send({ events })
        .expect(201);

      expect(response.body.balance).toBe(0);
      const task = response.body.tasks.find((t: any) => t.key === 'color_completion');
      expect(task).toMatchObject({
        progress: 0,
        completed: false,
        granted: false,
      });
    });

    it('getBoard returns correct progress and status details', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('Daily Board test', 5, 5);
      const sessionId = await prepareSession(account.accessToken, patternId);

      const events = [];
      for (let i = 0; i < 5; i++) {
        events.push({
          eventId: randomUUID(),
          kind: 'stitch_action',
          sessionId,
          dmcCode: '333',
          clientSeq: i,
          occurredAt: new Date(Date.now() - (5 - i) * 1000).toISOString(),
        });
      }

      await request(httpServer)
        .post('/v1/economy/daily-tasks/events')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ events })
        .expect(201);

      const boardResponse = await request(httpServer)
        .get('/v1/economy/daily-tasks')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);

      expect(boardResponse.body.tasks).toHaveLength(3);
      expect(boardResponse.body.tasks[0]).toMatchObject({
        key: 'cells_100',
        target: 100,
        progress: 5,
        completed: false,
        granted: false,
      });
      expect(boardResponse.body.tasks[1]).toMatchObject({
        key: 'three_colors_10',
        target: 3,
        progress: 0,
        completed: false,
        granted: false,
      });
      expect(boardResponse.body.tasks[2]).toMatchObject({
        key: 'color_completion',
        target: 1,
        progress: 0,
        completed: false,
        granted: false,
      });
    });

    it('processes a realistic mixed stitch sweep and updates tasks & database tables correctly', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('Daily Sweep test', 10, 10);
      const sessionId = await prepareSession(account.accessToken, patternId);

      const events = [];
      let seq = 0;
      // 5 stitch actions for '310'
      for (let i = 0; i < 5; i++) {
        events.push({
          eventId: randomUUID(),
          kind: 'stitch_action',
          sessionId,
          dmcCode: '310',
          clientSeq: seq++,
          occurredAt: new Date(Date.now() - (14 - seq) * 1000).toISOString(),
        });
      }
      // 8 stitch actions for 'B5200'
      for (let i = 0; i < 8; i++) {
        events.push({
          eventId: randomUUID(),
          kind: 'stitch_action',
          sessionId,
          dmcCode: 'B5200',
          clientSeq: seq++,
          occurredAt: new Date(Date.now() - (14 - seq) * 1000).toISOString(),
        });
      }
      // 1 color_completion event for '310'
      events.push({
        eventId: randomUUID(),
        kind: 'color_completion',
        sessionId,
        dmcCode: '310',
        clientSeq: seq++,
        occurredAt: new Date().toISOString(),
      });

      const response = await request(httpServer)
        .post('/v1/economy/daily-tasks/events')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ events })
        .expect(201);

      // Also assert the response body's tasks array shows color_completion granted true,
      // and cells_100/three_colors_10 not yet completed (since neither threshold was reached).
      const colorCompTask = response.body.tasks.find((t: any) => t.key === 'color_completion');
      expect(colorCompTask).toMatchObject({
        progress: 1,
        completed: true,
        granted: true,
      });

      const cellsTask = response.body.tasks.find((t: any) => t.key === 'cells_100');
      expect(cellsTask).toMatchObject({
        progress: 13,
        completed: false,
        granted: false,
      });

      const threeColorsTask = response.body.tasks.find((t: any) => t.key === 'three_colors_10');
      expect(threeColorsTask).toMatchObject({
        progress: 0,
        completed: false,
        granted: false,
      });

      // Query economy.gameplay_events for the session's principal and assert the correct row count
      // and that the color_completion kind row's dmc_code matches.
      const dbEvents = await dataSource.query<{ kind: string; dmc_code: string }[]>(
        `SELECT kind, dmc_code FROM economy.gameplay_events
         WHERE principal_type = 'account' AND principal_id = $1`,
        [account.accountId],
      );
      expect(dbEvents).toHaveLength(14);
      const colorCompRow = dbEvents.find((row) => row.kind === 'color_completion');
      expect(colorCompRow).toBeDefined();
      expect(colorCompRow?.dmc_code).toBe('310');

      // Query economy.daily_color_action_counts and assert action_count per dmc_code matches
      // how many stitch_action events were sent for that color.
      const colorCounts = await dataSource.query<{ dmc_code: string; action_count: number }[]>(
        `SELECT dmc_code, action_count FROM economy.daily_color_action_counts
         WHERE principal_type = 'account' AND principal_id = $1`,
        [account.accountId],
      );
      expect(colorCounts).toHaveLength(2);
      const count310 = colorCounts.find((row) => row.dmc_code === '310');
      expect(count310).toBeDefined();
      expect(Number(count310?.action_count)).toBe(5);

      const countB5200 = colorCounts.find((row) => row.dmc_code === 'B5200');
      expect(countB5200).toBeDefined();
      expect(Number(countB5200?.action_count)).toBe(8);
    });

    it('attributes an offline event to the Reward Day it occurred on, not the day it is flushed (issue #44)', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('Daily Reward Day Boundary', 5, 5);
      const sessionId = await prepareSession(account.accessToken, patternId);

      const now = new Date();
      const yesterdayUtc = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - 1,
        12, 0, 0,
      ));
      const yesterdayRewardDay = yesterdayUtc.toISOString().slice(0, 10);
      const todayRewardDay = now.toISOString().slice(0, 10);

      const response = await request(httpServer)
        .post('/v1/economy/daily-tasks/events')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          events: [{
            eventId: randomUUID(),
            kind: 'color_completion',
            sessionId,
            dmcCode: '310',
            clientSeq: 0,
            occurredAt: yesterdayUtc.toISOString(),
          }],
        })
        .expect(201);

      // The returned board reflects today's Reward Day, which this backdated
      // event never touches.
      expect(response.body.rewardDay).toBe(todayRewardDay);
      const todayTask = response.body.tasks.find((t: any) => t.key === 'color_completion');
      expect(todayTask).toMatchObject({ progress: 0, completed: false, granted: false });

      const dbEvents = await dataSource.query<{ reward_day: string }[]>(
        `SELECT reward_day::text AS reward_day FROM economy.gameplay_events
         WHERE principal_type = 'account' AND principal_id = $1`,
        [account.accountId],
      );
      expect(dbEvents).toHaveLength(1);
      expect(dbEvents[0].reward_day).toBe(yesterdayRewardDay);

      const ledgerRows = await dataSource.query<{ source_key: string; granted: boolean }[]>(
        `SELECT source_key, granted FROM economy.coin_ledger_entries
         WHERE principal_type = 'account' AND principal_id = $1 AND reason = 'daily_task'`,
        [account.accountId],
      );
      expect(ledgerRows).toHaveLength(1);
      expect(ledgerRows[0].source_key).toBe(
        `daily_task:account:${account.accountId}:${yesterdayRewardDay}:color_completion`,
      );
      expect(ledgerRows[0].granted).toBe(true);
    });

    it('rejects a burst of stitch actions denser than physically plausible (velocity guard, issue #44)', async () => {
      const account = await createAccount();
      const patternId = await seedPattern('Daily Velocity Guard', 10, 10);
      const sessionId = await prepareSession(account.accessToken, patternId);

      // 100 stitch actions all reported at the identical instant: physically
      // impossible for manual stitching. Only the first survives the guard.
      const sameInstant = new Date().toISOString();
      const events = Array.from({ length: 100 }, (_, i) => ({
        eventId: randomUUID(),
        kind: 'stitch_action',
        sessionId,
        dmcCode: '310',
        clientSeq: i,
        occurredAt: sameInstant,
      }));

      const response = await request(httpServer)
        .post('/v1/economy/daily-tasks/events')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ events })
        .expect(201);

      const cellsTask = response.body.tasks.find((t: any) => t.key === 'cells_100');
      expect(cellsTask).toMatchObject({ progress: 1, completed: false, granted: false });

      const dbEvents = await dataSource.query<{ event_id: string }[]>(
        `SELECT event_id FROM economy.gameplay_events
         WHERE principal_type = 'account' AND principal_id = $1`,
        [account.accountId],
      );
      expect(dbEvents).toHaveLength(1);
    });
  });

  describe('Commerce and RevenueCat Webhook', () => {
    async function newRegisteredAccount(): Promise<{ accountId: string; accessToken: string }> {
      const email = `rc-test-${randomUUID()}@example.test`;
      await requestEmailOtp(httpServer, email);
      const code = await dispatchAndReadEmailOtp(email);
      const verified = await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ code, email })
        .expect(200);

      const accountId = readStringRecord(verified.body, 'accountId');
      const accessToken = readStringRecord(verified.body, 'accessToken');
      return { accountId, accessToken };
    }

    const WEBHOOK_TOKEN = 'integration-test-only-revenuecat-webhook-auth-token-at-least-32-chars';

    it('uses the server capability toggle to refuse new guest commerce writes', async () => {
      const guest = await createGuestThroughApi(httpServer, randomUUID(), createCredentialSecret());
      const subscriberId = `$RCAnonymousID:${randomUUID()}`;
      const headers = { Authorization: `Bearer ${guest.accessToken}`, 'User-Agent': 'StitchWish/iOS' };
      await request(httpServer).post('/v1/commerce/guest/revenuecat-mapping')
        .set(headers).send({ subscriberId }).expect(201);
      const config = app.get(AppConfigService);
      const toggle = jest.spyOn(config, 'iosGuestCommerceEnabled', 'get').mockReturnValue(false);
      try {
        await request(httpServer).get('/v1/commerce/capabilities')
          .set('Authorization', `Bearer ${guest.accessToken}`).expect(200, { guestCommerceAvailable: false });
        await request(httpServer).post('/v1/commerce/guest/revenuecat-mapping')
          .set(headers)
          .send({ subscriberId }).expect(403)
          .expect((response) => expect(response.body).toMatchObject({
            message: 'Guest commerce is disabled; retry after ENABLE_IOS_GUEST_COMMERCE is enabled',
          }));
        await request(httpServer).post('/v1/commerce/guest/purchase-attempts')
          .set(headers).send({
            productId: 'com.avk.stitchwish.coin_pack_300',
            idempotencyKey: `disabled-${randomUUID()}`,
            subscriberId,
          }).expect(403).expect((response) => expect(response.body).toMatchObject({
            message: 'Guest commerce is disabled; retry after ENABLE_IOS_GUEST_COMMERCE is enabled',
          }));
      } finally {
        toggle.mockRestore();
      }
    });

    it('completes an iOS Guest Coin Pack attempt idempotently and scopes its status', async () => {
      const guest = await createGuestThroughApi(httpServer, randomUUID(), createCredentialSecret());
      const otherGuest = await createGuestThroughApi(httpServer, randomUUID(), createCredentialSecret());
      const subscriberId = `$RCAnonymousID:${randomUUID()}`;
      const userAgent = 'StitchWish/iOS';
      const headers = { Authorization: `Bearer ${guest.accessToken}`, 'User-Agent': userAgent };

      await request(httpServer).post('/v1/commerce/guest/revenuecat-mapping')
        .set('Authorization', `Bearer ${guest.accessToken}`).send({ subscriberId }).expect(403);
      await request(httpServer).post('/v1/commerce/guest/revenuecat-mapping')
        .set({ Authorization: `Bearer ${guest.accessToken}`, 'User-Agent': 'StitchWish/Android' })
        .send({ subscriberId }).expect(403);

      await request(httpServer).post('/v1/commerce/guest/revenuecat-mapping')
        .set(headers).send({ subscriberId }).expect(201, { mapped: true });
      const attemptResponse = await request(httpServer).post('/v1/commerce/guest/purchase-attempts')
        .set(headers).send({
          productId: 'com.avk.stitchwish.coin_pack_300',
          idempotencyKey: `guest-${randomUUID()}`,
          subscriberId,
        }).expect(201);
      const attemptId = readStringRecord(attemptResponse.body, 'id');
      const supportReference = readStringRecord(attemptResponse.body, 'supportReference');
      expect(supportReference).toMatch(/^SW-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

      await request(httpServer).get(`/v1/commerce/guest/purchase-attempts/${attemptId}`)
        .set('Authorization', `Bearer ${otherGuest.accessToken}`).expect(404);
      await request(httpServer).post('/v1/commerce/guest/purchase-attempts')
        .set(headers).send({ productId: 'com.avk.stitchwish.coin_pack_300', idempotencyKey: `other-${randomUUID()}`, subscriberId }).expect(409);

      const webhook = () => request(httpServer).post('/v1/commerce/revenuecat/webhook')
        .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`).send({ event: {
          type: 'NON_RENEWING_PURCHASE', app_user_id: subscriberId,
          aliases: [subscriberId], transaction_id: 'guest-integration-tx',
          product_id: 'com.avk.stitchwish.coin_pack_300', environment: 'SANDBOX',
        } });
      await webhook().expect(200, { status: 'ok' });
      await webhook().expect(200, { status: 'ok' });
      await request(httpServer).get('/v1/economy/balance')
        .set('Authorization', `Bearer ${guest.accessToken}`).expect(200, { balance: 300 });
      await request(httpServer).get(`/v1/commerce/guest/purchase-attempts/${attemptId}`)
        .set('Authorization', `Bearer ${guest.accessToken}`).expect(200)
        .expect((response) => expect(response.body.status).toBe('granted'));
    });

    it('reconciles delayed delivery after the client has restarted and exposes one grant', async () => {
      const guest = await createGuestThroughApi(httpServer, randomUUID(), createCredentialSecret());
      const subscriberId = `$RCAnonymousID:${randomUUID()}`;
      const headers = { Authorization: `Bearer ${guest.accessToken}`, 'User-Agent': 'StitchWish/iOS' };
      await request(httpServer).post('/v1/commerce/guest/revenuecat-mapping')
        .set(headers).send({ subscriberId }).expect(201);
      const attempt = await request(httpServer).post('/v1/commerce/guest/purchase-attempts')
        .set(headers).send({
          productId: 'com.avk.stitchwish.coin_pack_300',
          idempotencyKey: `delayed-${randomUUID()}`,
          subscriberId,
        }).expect(201);

      // No client state is reused after the restart; the durable attempt is enough.
      await request(httpServer).post('/v1/commerce/revenuecat/webhook')
        .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`).send({ event: {
          type: 'NON_RENEWING_PURCHASE', app_user_id: subscriberId, aliases: [subscriberId],
          transaction_id: `delayed-${randomUUID()}`, product_id: 'com.avk.stitchwish.coin_pack_300',
          environment: 'SANDBOX',
        } }).expect(200, { status: 'ok' });
      await request(httpServer).get('/v1/economy/balance')
        .set('Authorization', `Bearer ${guest.accessToken}`).expect(200, { balance: 300 });
      await request(httpServer).get(`/v1/commerce/guest/purchase-attempts/${readStringRecord(attempt.body, 'id')}`)
        .set('Authorization', `Bearer ${guest.accessToken}`).expect(200)
        .expect((response) => expect(response.body.status).toBe('granted'));
    });

    it('keeps the final state correct when a later webhook arrives before an earlier one', async () => {
      const guest = await createGuestThroughApi(httpServer, randomUUID(), createCredentialSecret());
      const subscriberId = `$RCAnonymousID:${randomUUID()}`;
      const headers = { Authorization: `Bearer ${guest.accessToken}`, 'User-Agent': 'StitchWish/iOS' };
      await request(httpServer).post('/v1/commerce/guest/revenuecat-mapping')
        .set(headers).send({ subscriberId }).expect(201);
      await request(httpServer).post('/v1/commerce/guest/purchase-attempts')
        .set(headers).send({
          productId: 'com.avk.stitchwish.coin_pack_300',
          idempotencyKey: `ordered-${randomUUID()}`,
          subscriberId,
        }).expect(201);

      const webhook = (transactionId: string) => request(httpServer)
        .post('/v1/commerce/revenuecat/webhook').set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
        .send({ event: {
          type: 'NON_RENEWING_PURCHASE', app_user_id: subscriberId, aliases: [subscriberId],
          transaction_id: transactionId, product_id: 'com.avk.stitchwish.coin_pack_300',
          environment: 'SANDBOX',
        } });
      await webhook(`later-${randomUUID()}`).expect(200, { status: 'ok' });
      await webhook(`earlier-${randomUUID()}`).expect(200, { status: 'ok' });
      await request(httpServer).get('/v1/economy/balance')
        .set('Authorization', `Bearer ${guest.accessToken}`).expect(200, { balance: 300 });
    });

    it('refuses unresolved repurchases but allows a new attempt after a grant', async () => {
      const guest = await createGuestThroughApi(httpServer, randomUUID(), createCredentialSecret());
      const subscriberId = `$RCAnonymousID:${randomUUID()}`;
      const headers = { Authorization: `Bearer ${guest.accessToken}`, 'User-Agent': 'StitchWish/iOS' };
      await request(httpServer).post('/v1/commerce/guest/revenuecat-mapping')
        .set(headers).send({ subscriberId }).expect(201);
      const firstKey = `repurchase-${randomUUID()}`;
      await request(httpServer).post('/v1/commerce/guest/purchase-attempts').set(headers).send({
        productId: 'com.avk.stitchwish.coin_pack_300', idempotencyKey: firstKey, subscriberId,
      }).expect(201);
      await request(httpServer).post('/v1/commerce/guest/purchase-attempts').set(headers).send({
        productId: 'com.avk.stitchwish.coin_pack_300', idempotencyKey: `conflict-${randomUUID()}`, subscriberId,
      }).expect(409, { statusCode: 409, message: 'A purchase for this Stitch Coin Pack is already being verified', error: 'Conflict' });
      await request(httpServer).post('/v1/commerce/revenuecat/webhook')
        .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`).send({ event: {
          type: 'NON_RENEWING_PURCHASE', app_user_id: subscriberId, aliases: [subscriberId],
          transaction_id: `repurchase-granted-${randomUUID()}`, product_id: 'com.avk.stitchwish.coin_pack_300', environment: 'SANDBOX',
        } }).expect(200, { status: 'ok' });
      await request(httpServer).post('/v1/commerce/guest/purchase-attempts').set(headers).send({
        productId: 'com.avk.stitchwish.coin_pack_300', idempotencyKey: `second-${randomUUID()}`, subscriberId,
      }).expect(201);
    });

    it('returns one clean conflict when concurrent starts race the unresolved-product unique index', async () => {
      const guest = await createGuestThroughApi(httpServer, randomUUID(), createCredentialSecret());
      const subscriberId = `$RCAnonymousID:${randomUUID()}`;
      const headers = { Authorization: `Bearer ${guest.accessToken}`, 'User-Agent': 'StitchWish/iOS' };
      await request(httpServer).post('/v1/commerce/guest/revenuecat-mapping')
        .set(headers).send({ subscriberId }).expect(201);
      const start = (idempotencyKey: string) => request(httpServer)
        .post('/v1/commerce/guest/purchase-attempts').set(headers).send({
          productId: 'com.avk.stitchwish.coin_pack_300', idempotencyKey, subscriberId,
        });
      const responses = await Promise.all([
        start(`race-a-${randomUUID()}`),
        start(`race-b-${randomUUID()}`),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body).toMatchObject({
        statusCode: 409,
        message: 'A purchase for this Stitch Coin Pack is already being verified',
      });
    });

    it('CommerceLedgerRepository processes purchases and reversals idempotently', async () => {
      const account1 = await newRegisteredAccount();
      const account2 = await newRegisteredAccount();

      const commerceLedger = app.get(CommerceLedgerRepository);

      // (a) fresh purchase grants coin
      const coinTxId = `rc-coin-${randomUUID()}`;
      const coinResult = await commerceLedger.processPurchase({
        environment: 'sandbox',
        providerTransactionId: coinTxId,
        accountId: account1.accountId,
        productId: 'com.avk.stitchwish.coin_pack_300',
      });
      expect(coinResult).toEqual({
        outcome: 'granted',
        currency: 'coin',
        amount: 300,
        balance: 300,
      });

      // (b) fresh purchase grants AI credit
      const aiTxId = `rc-ai-${randomUUID()}`;
      const aiResult = await commerceLedger.processPurchase({
        environment: 'sandbox',
        providerTransactionId: aiTxId,
        accountId: account1.accountId,
        productId: 'com.avk.stitchwish.ai_credit_pack_5',
      });
      expect(aiResult).toEqual({
        outcome: 'granted',
        currency: 'ai_credit',
        amount: 5,
        balance: 5,
      });

      // (c) duplicate webhook delivery for the same transaction+account is idempotent (no double balance)
      const duplicateResult = await commerceLedger.processPurchase({
        environment: 'sandbox',
        providerTransactionId: aiTxId,
        accountId: account1.accountId,
        productId: 'com.avk.stitchwish.ai_credit_pack_5',
      });
      expect(duplicateResult).toEqual({
        outcome: 'replayed_same_account',
        currency: 'ai_credit',
        amount: 5,
        balance: 5,
      });

      // (d) a second account attempting to claim an already-bound transaction is rejected and gets zero balance change
      const fraudulentResult = await commerceLedger.processPurchase({
        environment: 'sandbox',
        providerTransactionId: aiTxId,
        accountId: account2.accountId,
        productId: 'com.avk.stitchwish.ai_credit_pack_5',
      });
      expect(fraudulentResult).toEqual({
        outcome: 'rejected_other_account',
        currency: 'ai_credit',
        amount: 0,
        balance: null,
      });

      // (e) unknown product_id returns unknown_product and grants nothing
      const unknownResult = await commerceLedger.processPurchase({
        environment: 'sandbox',
        providerTransactionId: `rc-unk-${randomUUID()}`,
        accountId: account1.accountId,
        productId: 'invalid_pack_id',
      });
      expect(unknownResult).toEqual({
        outcome: 'unknown_product',
        currency: null,
        amount: 0,
        balance: null,
      });

      // (f) reversal withdraws exactly the granted amount and can drive balance negative
      const aiReversal = await commerceLedger.processReversal({
        environment: 'sandbox',
        providerTransactionId: aiTxId,
      });
      expect(aiReversal).toEqual({
        applied: true,
        currency: 'ai_credit',
        amount: 5,
        balance: 0,
      });

      // Let's do a reversal for coin that drives balance negative!
      await dataSource.query(
        `UPDATE economy.coin_balances SET balance = 0 WHERE principal_type = 'account' AND principal_id = $1`,
        [account1.accountId],
      );

      const coinReversal = await commerceLedger.processReversal({
        environment: 'sandbox',
        providerTransactionId: coinTxId,
      });
      expect(coinReversal).toEqual({
        applied: true,
        currency: 'coin',
        amount: 300,
        balance: -300,
      });

      // (g) reversal is idempotent under duplicate REFUND webhooks
      const duplicateReversal = await commerceLedger.processReversal({
        environment: 'sandbox',
        providerTransactionId: coinTxId,
      });
      expect(duplicateReversal).toEqual({
        applied: false,
        currency: 'coin',
        amount: 0,
        balance: -300,
      });

      // (h) reversal for a transaction with no binding is a safe no-op
      const unboundReversal = await commerceLedger.processReversal({
        environment: 'sandbox',
        providerTransactionId: `rc-unbound-${randomUUID()}`,
      });
      expect(unboundReversal).toEqual({
        applied: false,
        currency: null,
        amount: 0,
        balance: null,
      });
    });

    it('handles webhooks and authenticates correctly', async () => {
      const account = await newRegisteredAccount();
      const transactionId = `webhook-tx-${randomUUID()}`;

      // 1. Unauthorized webhook -> 401
      await request(httpServer)
        .post('/v1/commerce/revenuecat/webhook')
        .send({
          event: {
            type: 'NON_RENEWING_PURCHASE',
            app_user_id: account.accountId,
            transaction_id: transactionId,
            product_id: 'com.avk.stitchwish.coin_pack_900',
            environment: 'SANDBOX',
          },
        })
        .expect(401);

      await request(httpServer)
        .post('/v1/commerce/revenuecat/webhook')
        .set('Authorization', 'Bearer invalid_token')
        .send({
          event: {
            type: 'NON_RENEWING_PURCHASE',
            app_user_id: account.accountId,
            transaction_id: transactionId,
            product_id: 'com.avk.stitchwish.coin_pack_900',
            environment: 'SANDBOX',
          },
        })
        .expect(401);

      const reconciliationResponse = await request(httpServer)
        .post('/v1/commerce/coin-packs/reconciliations')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          productKey: 'coin_pack_900',
          transactionIdentifier: transactionId,
        })
        .expect(201);
      const reconciliationId = readStringRecord(reconciliationResponse.body, 'id');
      expect(readStringRecord(reconciliationResponse.body, 'supportReference')).toMatch(
        /^SW-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
      );
      await request(httpServer)
        .get(`/v1/commerce/coin-packs/reconciliations/${reconciliationId}`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200, { status: 'pending', balance: null });

      // 2. NON_RENEWING_PURCHASE happy path -> balance increases
      await request(httpServer)
        .post('/v1/commerce/revenuecat/webhook')
        .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
        .send({
          event: {
            type: 'NON_RENEWING_PURCHASE',
            app_user_id: account.accountId,
            transaction_id: transactionId,
            product_id: 'com.avk.stitchwish.coin_pack_900',
            environment: 'SANDBOX',
          },
        })
        .expect(200, { status: 'ok' });

      // Check balance
      const coinBalRes = await request(httpServer)
        .get('/v1/economy/balance')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      expect(coinBalRes.body.balance).toBe(900);
      await request(httpServer)
        .get(`/v1/commerce/coin-packs/reconciliations/${reconciliationId}`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200, { status: 'granted', balance: 900 });

      // 3. Duplicate delivery -> same balance, no double-grant
      await request(httpServer)
        .post('/v1/commerce/revenuecat/webhook')
        .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
        .send({
          event: {
            type: 'NON_RENEWING_PURCHASE',
            app_user_id: account.accountId,
            transaction_id: transactionId,
            product_id: 'com.avk.stitchwish.coin_pack_900',
            environment: 'SANDBOX',
          },
        })
        .expect(200, { status: 'ok' });

      const coinBalRes2 = await request(httpServer)
        .get('/v1/economy/balance')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      expect(coinBalRes2.body.balance).toBe(900);

      // Test AI credit balance endpoint and webhook
      const aiTxId = `webhook-ai-tx-${randomUUID()}`;
      const aiReconciliationResponse = await request(httpServer)
        .post('/v1/commerce/ai-credit-packs/reconciliations')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          productKey: 'ai_credit_pack_20',
          transactionIdentifier: aiTxId,
        })
        .expect(201);
      const aiReconciliationId = readStringRecord(aiReconciliationResponse.body, 'id');
      expect(readStringRecord(aiReconciliationResponse.body, 'supportReference')).toMatch(
        /^SW-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
      );
      await request(httpServer)
        .get(`/v1/commerce/ai-credit-packs/reconciliations/${aiReconciliationId}`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200, { status: 'pending', balance: null });

      // RevenueCat subscriber identity must resolve to an active Registered Account.
      await request(httpServer)
        .post('/v1/commerce/revenuecat/webhook')
        .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
        .send({
          event: {
            type: 'NON_RENEWING_PURCHASE',
            app_user_id: randomUUID(),
            transaction_id: aiTxId,
            product_id: 'com.avk.stitchwish.ai_credit_pack_20',
            environment: 'SANDBOX',
          },
        })
        .expect(200, { status: 'ok' });
      await request(httpServer)
        .get(`/v1/commerce/ai-credit-packs/reconciliations/${aiReconciliationId}`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200, { status: 'pending', balance: null });

      await request(httpServer)
        .post('/v1/commerce/revenuecat/webhook')
        .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
        .send({
          event: {
            type: 'NON_RENEWING_PURCHASE',
            app_user_id: account.accountId,
            transaction_id: aiTxId,
            product_id: 'com.avk.stitchwish.ai_credit_pack_20',
            environment: 'SANDBOX',
          },
        })
        .expect(200, { status: 'ok' });

      await request(httpServer)
        .get('/v1/economy/ai-credit-balance')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200, { balance: 20 });
      await request(httpServer)
        .get(`/v1/commerce/ai-credit-packs/reconciliations/${aiReconciliationId}`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200, { status: 'granted', balance: 20 });

      // Duplicate AI Credit delivery is safe and cannot grant the pack twice.
      await request(httpServer)
        .post('/v1/commerce/revenuecat/webhook')
        .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
        .send({
          event: {
            type: 'NON_RENEWING_PURCHASE',
            app_user_id: account.accountId,
            transaction_id: aiTxId,
            product_id: 'com.avk.stitchwish.ai_credit_pack_20',
            environment: 'SANDBOX',
          },
        })
        .expect(200, { status: 'ok' });
      await request(httpServer)
        .get('/v1/economy/ai-credit-balance')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200, { balance: 20 });

      // 4. REFUND after a grant -> balance decreases by the granted amount
      await request(httpServer)
        .post('/v1/commerce/revenuecat/webhook')
        .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
        .send({
          event: {
            type: 'REFUND',
            app_user_id: account.accountId,
            transaction_id: transactionId,
            product_id: 'com.avk.stitchwish.coin_pack_900',
            environment: 'SANDBOX',
          },
        })
        .expect(200, { status: 'ok' });

      const coinBalRes3 = await request(httpServer)
        .get('/v1/economy/balance')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      expect(coinBalRes3.body.balance).toBe(0);

      // 5. REFUND with no prior binding -> 200, no-op
      const unboundTxId = `unbound-tx-${randomUUID()}`;
      await request(httpServer)
        .post('/v1/commerce/revenuecat/webhook')
        .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
        .send({
          event: {
            type: 'REFUND',
            app_user_id: account.accountId,
            transaction_id: unboundTxId,
            product_id: 'com.avk.stitchwish.coin_pack_900',
            environment: 'SANDBOX',
          },
        })
        .expect(200, { status: 'ok' });
    });

    it('derives Premium Membership from periods and shares the daily Coin pool', async () => {
      const account = await newRegisteredAccount();
      const originalTransactionId = `premium-original-${randomUUID()}`;
      const oldTransactionId = `premium-weekly-${randomUUID()}`;
      const newTransactionId = `premium-monthly-${randomUUID()}`;
      const now = Date.now();
      const webhook = (event: Record<string, unknown>) =>
        request(httpServer)
          .post('/v1/commerce/revenuecat/webhook')
          .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
          .send({ event });
      const baseEvent = {
        app_user_id: account.accountId,
        original_transaction_id: originalTransactionId,
        environment: 'SANDBOX',
        period_type: 'NORMAL',
      };

      // An older Weekly paid period grants exactly three credits.
      await webhook({
        ...baseEvent,
        id: `event-${randomUUID()}`,
        type: 'INITIAL_PURCHASE',
        transaction_id: oldTransactionId,
        product_id: 'com.avk.stitchwish.premium_weekly',
        event_timestamp_ms: now - 8 * 86_400_000,
        purchased_at_ms: now - 8 * 86_400_000,
        expiration_at_ms: now - 60_000,
      }).expect(200, { status: 'ok' });

      const renewalEvent = {
        ...baseEvent,
        id: `event-${randomUUID()}`,
        type: 'RENEWAL',
        transaction_id: newTransactionId,
        product_id: 'com.avk.stitchwish.premium_monthly',
        event_timestamp_ms: now - 30_000,
        purchased_at_ms: now - 60_000,
        expiration_at_ms: now + 30 * 86_400_000,
        is_trial_conversion: true,
      };
      await webhook(renewalEvent).expect(200, { status: 'ok' });
      await webhook(renewalEvent).expect(200, { status: 'ok' });

      // A delayed expiration for the older transaction cannot turn off the
      // later monthly period even though it arrives after the renewal.
      await webhook({
        ...baseEvent,
        id: `event-${randomUUID()}`,
        type: 'EXPIRATION',
        transaction_id: oldTransactionId,
        product_id: 'com.avk.stitchwish.premium_weekly',
        event_timestamp_ms: now - 10_000,
        purchased_at_ms: now - 8 * 86_400_000,
        expiration_at_ms: now - 60_000,
      }).expect(200, { status: 'ok' });

      const membership = await request(httpServer)
        .get('/v1/commerce/membership')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      expect(membership.body).toMatchObject({
        active: true,
        plan: 'monthly',
        lifecycle: 'active',
        themeAccess: true,
      });

      const creditsBeforeRefund = await request(httpServer)
        .get('/v1/economy/ai-credit-balance')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      expect(creditsBeforeRefund.body.balance).toBe(18);

      // Refund only the older Weekly period. Its three credits are reversed,
      // while the newer Monthly entitlement remains active.
      const refundEvent = {
        ...baseEvent,
        id: `event-${randomUUID()}`,
        type: 'CANCELLATION',
        cancel_reason: 'CUSTOMER_SUPPORT',
        transaction_id: oldTransactionId,
        product_id: 'com.avk.stitchwish.premium_weekly',
        event_timestamp_ms: now,
        purchased_at_ms: now - 8 * 86_400_000,
        expiration_at_ms: now - 60_000,
      };
      await webhook(refundEvent).expect(200, { status: 'ok' });
      await webhook(refundEvent).expect(200, { status: 'ok' });

      const creditsAfterRefund = await request(httpServer)
        .get('/v1/economy/ai-credit-balance')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(200);
      expect(creditsAfterRefund.body.balance).toBe(15);

      const ledger = app.get(CoinLedgerRepository);
      const principal = { type: 'account' as const, id: account.accountId };
      const rewardDay = utcRewardDay();
      await ledger.grantAdReward(
        principal,
        rewardDay,
        `ad:premium-order-${randomUUID()}`,
      );

      const claim = await request(httpServer)
        .post('/v1/commerce/membership/daily-claim')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(201);
      expect(claim.body).toMatchObject({ amount: 20, coinsConsumed: 30, replayed: false });

      const replay = await request(httpServer)
        .post('/v1/commerce/membership/daily-claim')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .expect(201);
      expect(replay.body).toMatchObject({ amount: 20, coinsConsumed: 30, replayed: true });

      const adAfterClaim = await ledger.grantAdReward(
        principal,
        rewardDay,
        `ad:after-premium-claim-${randomUUID()}`,
      );
      expect(adAfterClaim).toMatchObject({ granted: false, amount: 0 });
      expect(await ledger.getBalance(principal)).toBe(30);
    });

    it('moves Premium Membership to the account a store subscription is transferred to', async () => {
      const previous = await newRegisteredAccount();
      const next = await newRegisteredAccount();
      const originalTransactionId = `premium-transfer-original-${randomUUID()}`;
      const transactionId = `premium-transfer-${randomUUID()}`;
      const now = Date.now();
      const webhook = (event: Record<string, unknown>) =>
        request(httpServer)
          .post('/v1/commerce/revenuecat/webhook')
          .set('Authorization', `Bearer ${WEBHOOK_TOKEN}`)
          .send({ event });
      const membershipOf = async (accessToken: string): Promise<unknown> => {
        const response = await request(httpServer)
          .get('/v1/commerce/membership')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);
        return response.body;
      };

      await webhook({
        id: `event-${randomUUID()}`,
        type: 'INITIAL_PURCHASE',
        app_user_id: previous.accountId,
        transaction_id: transactionId,
        original_transaction_id: originalTransactionId,
        product_id: 'com.avk.stitchwish.premium_annual',
        environment: 'SANDBOX',
        period_type: 'NORMAL',
        event_timestamp_ms: now - 120_000,
        purchased_at_ms: now - 120_000,
        expiration_at_ms: now + 365 * 86_400_000,
      }).expect(200, { status: 'ok' });

      expect(await membershipOf(previous.accessToken)).toMatchObject({
        active: true,
        plan: 'annual',
      });

      // Before the transfer the second account claiming the same provider
      // transaction earns no entitlement. The delivery is answered 503 rather
      // than 200 so RevenueCat redelivers it once the transfer has landed.
      await webhook({
        id: `event-${randomUUID()}`,
        type: 'RENEWAL',
        app_user_id: next.accountId,
        transaction_id: transactionId,
        original_transaction_id: originalTransactionId,
        product_id: 'com.avk.stitchwish.premium_annual',
        environment: 'SANDBOX',
        period_type: 'NORMAL',
        event_timestamp_ms: now - 60_000,
        purchased_at_ms: now - 120_000,
        expiration_at_ms: now + 365 * 86_400_000,
      }).expect(503);
      expect(await membershipOf(next.accessToken)).toMatchObject({ active: false, plan: null });

      const transfer = {
        id: `event-${randomUUID()}`,
        type: 'TRANSFER',
        environment: 'SANDBOX',
        store: 'APP_STORE',
        transferred_from: [previous.accountId, `$RCAnonymousID:${randomUUID()}`],
        transferred_to: [next.accountId],
        event_timestamp_ms: now - 30_000,
      };
      await webhook(transfer).expect(200, { status: 'ok' });
      // A redelivered transfer must not bounce the entitlement back.
      await webhook(transfer).expect(200, { status: 'ok' });

      expect(await membershipOf(next.accessToken)).toMatchObject({
        active: true,
        plan: 'annual',
        lifecycle: 'active',
        themeAccess: true,
      });
      expect(await membershipOf(previous.accessToken)).toMatchObject({
        active: false,
        plan: null,
      });

      // Later store events for the transferred subscription now belong to the
      // new account instead of tripping the ownership guard.
      await webhook({
        id: `event-${randomUUID()}`,
        type: 'RENEWAL',
        app_user_id: next.accountId,
        transaction_id: transactionId,
        original_transaction_id: originalTransactionId,
        product_id: 'com.avk.stitchwish.premium_annual',
        environment: 'SANDBOX',
        period_type: 'NORMAL',
        event_timestamp_ms: now,
        purchased_at_ms: now - 120_000,
        expiration_at_ms: now + 730 * 86_400_000,
      }).expect(200, { status: 'ok' });

      expect(await membershipOf(next.accessToken)).toMatchObject({
        active: true,
        plan: 'annual',
        lifecycle: 'active',
      });
    });
  });

  describe('Guest Data Promotion stage 1', () => {
    const palette = [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: 'B5200', name: 'Snow White', rgbHex: '#FFFFFF' },
    ];

    async function seedPattern(
      title: string,
      width: number,
      height: number,
    ): Promise<string> {
      const catalog = app.get(CatalogService);
      const grid = new Uint8Array(width * height).fill(1);
      const encoded = encodePatternArtifactV1({ width, height, palette, grid });
      const objectKey = `itest-promo/${title}/artifact.bin`;
      await app.get(LocalObjectStorage).put(objectKey, encoded.bytes);
      const pattern = await catalog.upsertPattern({
        title,
        creatorName: 'ITest Promo Team',
        categoryCode: 'other',
        width,
        height,
        paletteSize: palette.length,
        artifactObjectKey: objectKey,
        artifactChecksum: encoded.checksum,
        artifactByteLength: encoded.byteLength,
        artifactSchemaVersion: encoded.schemaVersion,
        previewObjectKey: `itest-promo/${title}/preview.png`,
        unlockPriceTier: 'small',
        status: 'available',
        publishedAt: new Date('2026-07-01T00:00:00.000Z'),
        tagCodes: [],
      });
      return pattern.id;
    }

    async function createAccount(): Promise<{
      accountId: string;
      accessToken: string;
    }> {
      const email = `promo-${randomUUID()}@example.test`;
      await request(httpServer)
        .post('/v1/auth/email/request')
        .send({ email })
        .expect(202);
      const code = await dispatchAndReadEmailOtp(email);
      const verified = await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ email, code })
        .expect(200);
      return {
        accountId: readStringRecord(verified.body, 'accountId'),
        accessToken: readStringRecord(verified.body, 'accessToken'),
      };
    }

    it('handles preview, lock, stage package, and cancellation flow', async () => {
      const credentialSecret = createCredentialSecret();
      const installationKey = randomUUID();
      const guest = await createGuestThroughApi(httpServer, installationKey, credentialSecret);
      const account = await createAccount();

      // 1. Generate preview
      const previewRes = await request(httpServer)
        .post('/v1/promotion/preview')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          guestId: guest.guestId,
          guestCredential: credentialSecret,
          manifestChecksum: 'manifest-chk-123',
          manifest: {
            progress: {},
            completions: {},
            likes: {},
            pendingRewards: {
              'daily_task:123': {}
            }
          }
        })
        .expect(200);

      expect(previewRes.body.guestId).toBe(guest.guestId);
      expect(previewRes.body.promotionMode).toBe('economy');
      expect(previewRes.body.signature).toBeDefined();

      const previewData = {
        guestId: previewRes.body.guestId,
        accountId: previewRes.body.accountId,
        manifestChecksum: previewRes.body.manifestChecksum,
        promotionMode: previewRes.body.promotionMode,
        guestLedgerBalance: previewRes.body.guestLedgerBalance,
        expiry: previewRes.body.expiry,
      };

      // 2. Lock guest identity
      const lockRes = await request(httpServer)
        .post('/v1/promotion/lock')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          previewData,
          signature: previewRes.body.signature,
        })
        .expect(200);

      expect(lockRes.body.lockToken).toBeDefined();

      // 3. Verify guest mutations are blocked
      // Try pattern unlock
      await request(httpServer)
        .post('/v1/economy/unlocks')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId: randomUUID() })
        .expect(409); // Conflict: Locked!

      // 4. Stage Promotion Transfer Package
      const stageRes = await request(httpServer)
        .post('/v1/promotion/stage-package')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          guestId: guest.guestId,
          lockToken: lockRes.body.lockToken,
          manifestChecksum: 'manifest-chk-123',
          packageData: { progress: 'some-data' },
          checksum: 'package-checksum-456',
        })
        .expect(200);

      expect(stageRes.body.status).toBe('staged');

      // 5. Cancel promotion
      await request(httpServer)
        .post('/v1/promotion/cancel')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ guestId: guest.guestId })
        .expect(200);

      // 6. Verify guest mutations are unblocked now
      // Seed a pattern to unlock
      const patternId = await seedPattern('PromoUnlockTest', 2, 2);

      // Credit guest ledger balance first so they can unlock
      await dataSource.query(
        `INSERT INTO economy.coin_balances (principal_type, principal_id, balance)
         VALUES ('guest', $1, 100)`,
        [guest.guestId]
      );

      await request(httpServer)
        .post('/v1/economy/unlocks')
        .set('Authorization', `Bearer ${guest.accessToken}`)
        .send({ patternId })
        .expect(201); // Created (unlocked)!
    });
  });

  describe('Guest Data Promotion stage 2', () => {
    const palette = [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: 'B5200', name: 'Snow White', rgbHex: '#FFFFFF' },
    ];

    async function seedPattern(
      title: string,
      width: number,
      height: number,
    ): Promise<string> {
      const catalog = app.get(CatalogService);
      const grid = new Uint8Array(width * height).fill(1);
      const encoded = encodePatternArtifactV1({ width, height, palette, grid });
      const objectKey = `itest-promo2/${title}/artifact.bin`;
      await app.get(LocalObjectStorage).put(objectKey, encoded.bytes);
      const pattern = await catalog.upsertPattern({
        title,
        creatorName: 'ITest Promo 2 Team',
        categoryCode: 'other',
        width,
        height,
        paletteSize: palette.length,
        artifactObjectKey: objectKey,
        artifactChecksum: encoded.checksum,
        artifactByteLength: encoded.byteLength,
        artifactSchemaVersion: encoded.schemaVersion,
        previewObjectKey: `itest-promo2/${title}/preview.png`,
        unlockPriceTier: 'small',
        status: 'available',
        publishedAt: new Date('2026-07-01T00:00:00.000Z'),
        tagCodes: [],
      });
      return pattern.id;
    }

    async function createAccount(): Promise<{
      accountId: string;
      accessToken: string;
    }> {
      const email = `promo2-${randomUUID()}@example.test`;
      await request(httpServer)
        .post('/v1/auth/email/request')
        .send({ email })
        .expect(202);
      const code = await dispatchAndReadEmailOtp(email);
      const verified = await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ email, code })
        .expect(200);
      return {
        accountId: readStringRecord(verified.body, 'accountId'),
        accessToken: readStringRecord(verified.body, 'accessToken'),
      };
    }

    it('processes full commit, balance transfer, locks, and session merges', async () => {
      const credentialSecret = createCredentialSecret();
      const installationKey = randomUUID();
      const guest = await createGuestThroughApi(httpServer, installationKey, credentialSecret);
      const account = await createAccount();

      // Seed guest balance
      await dataSource.query(
        `INSERT INTO economy.coin_balances (principal_type, principal_id, balance)
         VALUES ('guest', $1, 150)`,
        [guest.guestId]
      );

      // 1. Generate preview
      const previewRes = await request(httpServer)
        .post('/v1/promotion/preview')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          guestId: guest.guestId,
          guestCredential: credentialSecret,
          manifestChecksum: 'chk-manifest-1',
          manifest: { progress: {}, completions: {}, likes: {}, pendingRewards: {} }
        })
        .expect(200);

      expect(previewRes.body.promotionMode).toBe('economy');
      expect(previewRes.body.guestLedgerBalance).toBe(150);

      const previewData = {
        guestId: previewRes.body.guestId,
        accountId: previewRes.body.accountId,
        manifestChecksum: previewRes.body.manifestChecksum,
        promotionMode: previewRes.body.promotionMode,
        guestLedgerBalance: previewRes.body.guestLedgerBalance,
        expiry: previewRes.body.expiry,
      };

      // 2. Lock
      const lockRes = await request(httpServer)
        .post('/v1/promotion/lock')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          previewData,
          signature: previewRes.body.signature,
        })
        .expect(200);

      // 3. Stage
      await request(httpServer)
        .post('/v1/promotion/stage-package')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          guestId: guest.guestId,
          lockToken: lockRes.body.lockToken,
          manifestChecksum: 'chk-manifest-1',
          packageData: { sessions: [] },
          checksum: 'pkg-chk-1',
        })
        .expect(200);

      // 4. Commit
      const commitRes = await request(httpServer)
        .post('/v1/promotion/commit')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          previewData,
          signature: previewRes.body.signature,
        })
        .expect(200);

      expect(commitRes.body.status).toBe('committed');

      // 5. Verify balances
      const guestBal = await dataSource.query(`SELECT balance FROM economy.coin_balances WHERE principal_id = $1`, [guest.guestId]);
      expect(Number(guestBal[0].balance)).toBe(0);

      const accountBal = await dataSource.query(`SELECT balance FROM economy.coin_balances WHERE principal_id = $1`, [account.accountId]);
      expect(Number(accountBal[0].balance)).toBe(150);

      // 6. Verify second economy promotion goes to data-only
      const credentialSecret2 = createCredentialSecret();
      const guest2 = await createGuestThroughApi(httpServer, randomUUID(), credentialSecret2);
      const previewRes2 = await request(httpServer)
        .post('/v1/promotion/preview')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          guestId: guest2.guestId,
          guestCredential: credentialSecret2,
          manifestChecksum: 'chk-manifest-2',
          manifest: { progress: {}, completions: {}, likes: {}, pendingRewards: {} }
        })
        .expect(200);
      expect(previewRes2.body.promotionMode).toBe('data-only');

      // 7. Test Session Merge (active+active)
      const patternId = await seedPattern('MergePattern', 2, 2);

      // Create guest session
      const gSessionRes = await dataSource.query(
        `INSERT INTO sessions.stitching_sessions (principal_type, principal_id, pattern_id, status)
         VALUES ('guest', $1, $2, 'active') RETURNING id`,
        [guest.guestId, patternId]
      );
      const guestSessionId = gSessionRes[0].id;

      // Create target account session
      const aSessionRes = await dataSource.query(
        `INSERT INTO sessions.stitching_sessions (principal_type, principal_id, pattern_id, status)
         VALUES ('account', $1, $2, 'active') RETURNING id`,
        [account.accountId, patternId]
      );
      const accountSessionId = aSessionRes[0].id;

      // Seed progress operations
      await dataSource.query(
        `INSERT INTO sessions.progress_operations (session_id, op_id, device_id, device_seq, cell_index, desired_state, base_revision, server_revision, effective)
         VALUES ($1, $2, $3, 1, 0, 'completed', 0, 1, true)`,
        [guestSessionId, randomUUID(), randomUUID()]
      );

      await dataSource.query(
        `INSERT INTO sessions.session_cell_state (session_id, cell_index, state, revision)
         VALUES ($1, 0, 'completed', 1)`,
        [guestSessionId]
      );

      // Drain session
      const drainRes = await request(httpServer)
        .post('/v1/promotion/drain/session')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          guestId: guest.guestId,
          patternId,
          guestSessionId,
        })
        .expect(200);

      expect(drainRes.body.status).toBe('merged');

      // Verify guest session is deleted and merged
      const gSessCount = await dataSource.query(`SELECT 1 FROM sessions.stitching_sessions WHERE id = $1`, [guestSessionId]);
      expect(gSessCount).toHaveLength(0);

      const cellState = await dataSource.query(`SELECT state FROM sessions.session_cell_state WHERE session_id = $1 AND cell_index = 0`, [accountSessionId]);
      expect(cellState[0].state).toBe('completed');
    });

    it('rejects a fabricated or unowned pending-reward sourceKey and mints nothing for it (issue #44)', async () => {
      const credentialSecret = createCredentialSecret();
      const installationKey = randomUUID();
      const guest = await createGuestThroughApi(httpServer, installationKey, credentialSecret);
      const account = await createAccount();

      const otherGuestId = randomUUID(); // not this guest's own identity
      const fabricatedKey = `daily_task:guest:${otherGuestId}:2026-01-01:cells_100`;
      const malformedKey = 'not-a-real-pending-reward-key';

      const previewRes = await request(httpServer)
        .post('/v1/promotion/preview')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          guestId: guest.guestId,
          guestCredential: credentialSecret,
          manifestChecksum: 'chk-fabricated-1',
          manifest: {
            progress: {}, completions: {}, likes: {},
            pendingRewards: {
              [fabricatedKey]: {},
              [malformedKey]: {},
            },
          },
        })
        .expect(200);

      expect(previewRes.body.validatedPendingRewards).toEqual([]);
      expect(previewRes.body.rejectedPendingRewards[fabricatedKey]).toBe('ownership_mismatch');
      expect(previewRes.body.rejectedPendingRewards[malformedKey]).toBe('invalid_format');

      // A malicious client could try to bypass preview entirely and hand commit
      // a forged validatedPendingRewards list directly (the signature only
      // covers the core preview fields, not this list). Commit must
      // independently re-validate every sourceKey and mint nothing for either.
      const previewData = {
        guestId: previewRes.body.guestId,
        accountId: previewRes.body.accountId,
        manifestChecksum: previewRes.body.manifestChecksum,
        promotionMode: previewRes.body.promotionMode,
        guestLedgerBalance: previewRes.body.guestLedgerBalance,
        expiry: previewRes.body.expiry,
        validatedPendingRewards: [fabricatedKey, malformedKey],
      };

      const lockRes = await request(httpServer)
        .post('/v1/promotion/lock')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ previewData, signature: previewRes.body.signature })
        .expect(200);

      await request(httpServer)
        .post('/v1/promotion/stage-package')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          guestId: guest.guestId,
          lockToken: lockRes.body.lockToken,
          manifestChecksum: 'chk-fabricated-1',
          packageData: {},
          checksum: 'pkg-chk-fabricated-1',
        })
        .expect(200);

      await request(httpServer)
        .post('/v1/promotion/commit')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ previewData, signature: previewRes.body.signature })
        .expect(200);

      const mintedRows = await dataSource.query(
        `SELECT 1 FROM economy.coin_ledger_entries WHERE source_key IN ($1, $2)`,
        [fabricatedKey, malformedKey],
      );
      expect(mintedRows).toHaveLength(0);

      const accountBal = await dataSource.query<{ balance: string }[]>(
        `SELECT balance FROM economy.coin_balances WHERE principal_type = 'account' AND principal_id = $1`,
        [account.accountId],
      );
      expect(accountBal.length === 0 ? 0 : Number(accountBal[0].balance)).toBe(0);
    });

    it('recomputes the server-authoritative tier amount for a validated pending First Completion reward (issue #44)', async () => {
      const credentialSecret = createCredentialSecret();
      const installationKey = randomUUID();
      const guest = await createGuestThroughApi(httpServer, installationKey, credentialSecret);
      const account = await createAccount();

      // Medium tier: 4,000-14,999 cells (ADR-0011). 64x64 = 4,096 cells.
      const patternId = await seedPattern('Promo Medium Completion', 64, 64);

      // Simulate the guest having actually completed this Pattern while offline.
      await dataSource.query(
        `INSERT INTO sessions.stitching_sessions (principal_type, principal_id, pattern_id, status)
         VALUES ('guest', $1, $2, 'completed')`,
        [guest.guestId, patternId],
      );

      const pendingSourceKey = `first_completion:guest:${guest.guestId}:${patternId}`;

      const previewRes = await request(httpServer)
        .post('/v1/promotion/preview')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          guestId: guest.guestId,
          guestCredential: credentialSecret,
          manifestChecksum: 'chk-medium-1',
          manifest: {
            progress: {}, completions: {}, likes: {},
            pendingRewards: { [pendingSourceKey]: {} },
          },
        })
        .expect(200);

      expect(previewRes.body.validatedPendingRewards).toEqual([pendingSourceKey]);
      expect(previewRes.body.rejectedPendingRewards).toEqual({});

      const previewData = {
        guestId: previewRes.body.guestId,
        accountId: previewRes.body.accountId,
        manifestChecksum: previewRes.body.manifestChecksum,
        promotionMode: previewRes.body.promotionMode,
        guestLedgerBalance: previewRes.body.guestLedgerBalance,
        expiry: previewRes.body.expiry,
        validatedPendingRewards: previewRes.body.validatedPendingRewards,
      };

      const lockRes = await request(httpServer)
        .post('/v1/promotion/lock')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ previewData, signature: previewRes.body.signature })
        .expect(200);

      await request(httpServer)
        .post('/v1/promotion/stage-package')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({
          guestId: guest.guestId,
          lockToken: lockRes.body.lockToken,
          manifestChecksum: 'chk-medium-1',
          packageData: {},
          checksum: 'pkg-chk-medium-1',
        })
        .expect(200);

      await request(httpServer)
        .post('/v1/promotion/commit')
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ previewData, signature: previewRes.body.signature })
        .expect(200);

      const ledgerRow = await dataSource.query<{ amount: string; reason: string; granted: boolean }[]>(
        `SELECT amount, reason, granted FROM economy.coin_ledger_entries WHERE source_key = $1`,
        [pendingSourceKey],
      );
      expect(ledgerRow).toHaveLength(1);
      expect(ledgerRow[0].reason).toBe('first_completion');
      expect(Number(ledgerRow[0].amount)).toBe(60); // Medium tier, not the old hardcoded Small (25)
      expect(ledgerRow[0].granted).toBe(true);

      const accountBal = await dataSource.query<{ balance: string }[]>(
        `SELECT balance FROM economy.coin_balances WHERE principal_type = 'account' AND principal_id = $1`,
        [account.accountId],
      );
      expect(Number(accountBal[0].balance)).toBe(60);
    });
  });
});

async function createDemoJobThroughApi(
  httpServer: Server,
  message: string,
): Promise<string> {
  const response = await request(httpServer)
    .post('/v1/demo-jobs')
    .send({ message })
    .expect(201);
  const body: unknown = response.body;
  const id = readRecord(body, 'id');
  if (typeof id !== 'string') {
    throw new Error('Demo job creation response did not contain an id');
  }
  return id;
}

interface GuestSessionFixture {
  accessToken: string;
  guestId: string;
  refreshToken: string;
}

interface RefreshedSessionFixture {
  accessToken: string;
  refreshToken: string;
}

async function createGuestThroughApi(
  httpServer: Server,
  installationKey: string,
  credentialSecret: string,
): Promise<GuestSessionFixture> {
  const response = await request(httpServer)
    .post('/v1/auth/guest')
    .send({ credentialSecret, installationKey })
    .expect(201);
  const body: unknown = response.body;

  return {
    accessToken: readStringRecord(body, 'accessToken'),
    guestId: readStringRecord(body, 'guestId'),
    refreshToken: readStringRecord(body, 'refreshToken'),
  };
}

async function refreshThroughApi(
  httpServer: Server,
  refreshToken: string,
): Promise<RefreshedSessionFixture> {
  const response = await request(httpServer)
    .post('/v1/auth/refresh')
    .send({ refreshToken })
    .expect(200);
  const body: unknown = response.body;

  return {
    accessToken: readStringRecord(body, 'accessToken'),
    refreshToken: readStringRecord(body, 'refreshToken'),
  };
}

function createCredentialSecret(): string {
  return randomBytes(32).toString('base64url');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Buffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function waitForProcessingJob(
  processingJobs: ProcessingJobsRepository,
  processingJobId: string,
  expectedStatus: ProcessingJobStatus,
): Promise<ProcessingJobEntity> {
  return waitFor(async () => {
    const job = await processingJobs.findById(processingJobId);
    return job?.status === expectedStatus ? job : null;
  }, `Processing Job ${processingJobId} to reach ${expectedStatus}`);
}

async function waitForBullJobState(
  queue: DemoJobsQueueService,
  outboxId: string,
  expectedState: string,
): Promise<string> {
  return waitFor(async () => {
    const job = await queue.getJob(outboxId);
    if (job === undefined) {
      return null;
    }
    const state = await job.getState();
    return state === expectedState ? state : null;
  }, `BullMQ job ${outboxId} to reach ${expectedState}`);
}

async function waitFor<T>(
  probe: () => Promise<T | null>,
  description: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result !== null) {
      return result;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function readRecord(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected an object response body');
  }
  return (value as Record<string, unknown>)[key];
}

function readStringRecord(value: unknown, key: string): string {
  const result = readRecord(value, key);
  if (typeof result !== 'string') {
    throw new TypeError(`Expected ${key} to be a string`);
  }
  return result;
}
