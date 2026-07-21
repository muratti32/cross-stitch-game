import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import request from 'supertest';
import {
  GenericContainer,
  StartedTestContainer,
} from 'testcontainers';
import { DataSource, IsNull } from 'typeorm';
import { PNG } from 'pngjs';

import { configureApi } from '../src/api/configure-api';
import { CatalogService } from '../src/catalog/catalog.service';
import { encodePatternArtifactV1 } from '../src/catalog/pattern-artifact-encoder';
import { LocalObjectStorage } from '../src/catalog/storage/local-object-storage';
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
import { ACCESS_TOKEN_VERSION } from '../src/auth/auth.constants';
import { createTypeOrmOptions } from '../src/database/typeorm-options';
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
import { CoinLedgerRepository } from '../src/economy/coin-ledger.repository';
import { utcRewardDay } from '../src/economy/reward-day';

class ForcedRollbackError extends Error {
  constructor() {
    super('Force the job creation transaction to roll back');
    this.name = ForcedRollbackError.name;
  }
}

describe('Stitch Wish backend integration', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let migrationDataSource: DataSource | null = null;
  let app: INestApplication;
  let httpServer: Server;
  let dataSource: DataSource;
  let processingJobs: ProcessingJobsRepository;
  let dispatcher: OutboxDispatcherService;
  let queue: DemoJobsQueueService;
  let consumer: DemoJobConsumerService;
  let emailDispatcher: EmailOutboxDispatcherService;
  let localEmailSender: LocalEmailSender;

  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalJwtAccessTtlSeconds = process.env.JWT_ACCESS_TTL_SECONDS;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalRedisUrl = process.env.REDIS_URL;
  const originalRefreshTokenTtlSeconds =
    process.env.REFRESH_TOKEN_TTL_SECONDS;
  const originalPort = process.env.PORT;
  const originalOtpSigningSecret = process.env.OTP_SIGNING_SECRET;
  const originalEmailFromAddress = process.env.EMAIL_FROM_ADDRESS;
  const originalResendApiKey = process.env.RESEND_API_KEY;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('stitch_wish_test')
      .withUsername('stitch_wish_test')
      .withPassword('stitch_wish_test')
      .start();
    try {
      redis = await new GenericContainer('redis:7-alpine')
        .withExposedPorts(6379)
        .start();
    } catch (error: unknown) {
      await postgres.stop();
      throw error;
    }

    process.env.DATABASE_URL = postgres.getConnectionUri();
    process.env.JWT_ACCESS_TTL_SECONDS = '900';
    process.env.JWT_SECRET =
      'integration-test-only-not-a-real-jwt-secret';
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    process.env.REFRESH_TOKEN_TTL_SECONDS = '3600';
    process.env.PORT = '3000';
    process.env.OTP_SIGNING_SECRET =
      'integration-test-only-otp-signing-secret-at-least-32-chars';
    process.env.EMAIL_FROM_ADDRESS = 'integration@example.test';
    delete process.env.RESEND_API_KEY;

    migrationDataSource = new DataSource(
      createTypeOrmOptions(process.env.DATABASE_URL),
    );
    await migrationDataSource.initialize();
    await migrationDataSource.runMigrations();
    await migrationDataSource.destroy();
    migrationDataSource = null;

    const [{ ApiAppModule }, jobs] = await Promise.all([
      import('../src/app.api.module'),
      import('../src/jobs'),
    ]);
    // Keep email delivery hermetic: ConfigModule.forRoot reloads .env during
    // app.init() and would re-populate a real RESEND_API_KEY (deleted above),
    // steering the factory to the live Resend sender. Force the local sender so
    // the suite never touches the network regardless of the developer's .env.
    const moduleRef = await Test.createTestingModule({
      imports: [ApiAppModule, jobs.JobsWorkerModule],
    })
      .overrideProvider(EMAIL_SENDER)
      .useFactory({
        factory: (local: LocalEmailSender) => local,
        inject: [LocalEmailSender],
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
    const applicationCleanup = await Promise.allSettled([
      app === undefined ? Promise.resolve() : app.close(),
      migrationDataSource?.isInitialized === true
        ? migrationDataSource.destroy()
        : Promise.resolve(),
    ]);
    const containerCleanup = await Promise.allSettled([
      postgres === undefined ? Promise.resolve() : postgres.stop(),
      redis === undefined ? Promise.resolve() : redis.stop(),
    ]);
    restoreEnvironment('DATABASE_URL', originalDatabaseUrl);
    restoreEnvironment(
      'JWT_ACCESS_TTL_SECONDS',
      originalJwtAccessTtlSeconds,
    );
    restoreEnvironment('JWT_SECRET', originalJwtSecret);
    restoreEnvironment('REDIS_URL', originalRedisUrl);
    restoreEnvironment(
      'REFRESH_TOKEN_TTL_SECONDS',
      originalRefreshTokenTtlSeconds,
    );
    restoreEnvironment('PORT', originalPort);
    restoreEnvironment('OTP_SIGNING_SECRET', originalOtpSigningSecret);
    restoreEnvironment('EMAIL_FROM_ADDRESS', originalEmailFromAddress);
    restoreEnvironment('RESEND_API_KEY', originalResendApiKey);

    const cleanupFailure = [...applicationCleanup, ...containerCleanup].find(
      (result) => result.status === 'rejected',
    );
    if (cleanupFailure?.status === 'rejected') {
      throw cleanupFailure.reason;
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
    const created = await createGuestThroughApi(
      httpServer,
      randomUUID(),
      createCredentialSecret(),
    );

    await request(httpServer).get('/v1/auth/session').expect(401);
    await request(httpServer)
      .get('/v1/auth/session')
      .set('Authorization', `Bearer ${created.accessToken}`)
      .expect(200)
      .expect({
        id: created.guestId,
        tokenVersion: ACCESS_TOKEN_VERSION,
        type: PrincipalType.Guest,
      });
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
      await emailDispatcher.dispatchOnce();
      const redelivered = localEmailSender.getDeliveries()[beforeRedelivery];
      expect(redelivered?.code).toBe(firstCode);
      const activeCodes = await dataSource
        .getRepository(EmailVerificationCodeEntity)
        .countBy({ email, consumedAt: IsNull(), supersededAt: IsNull() });
      expect(activeCodes).toBe(0);
    });

    async function requestEmailOtp(server: Server, email: string): Promise<void> {
      await request(server)
        .post('/v1/auth/email/request')
        .send({ email })
        .expect(202)
        .expect({ status: 'sent' });
    }

    async function dispatchAndReadEmailOtp(email: string): Promise<string> {
      const deliveryCount = localEmailSender.getDeliveries().length;
      await emailDispatcher.dispatchOnce();
      // A single dispatch may also flush unrelated rows left undispatched by
      // earlier tests, so select the newest delivery for this exact address.
      const delivery = localEmailSender
        .getDeliveries()
        .slice(deliveryCount)
        .reverse()
        .find((candidate) => candidate.toEmail === email);
      if (delivery === undefined) {
        throw new Error('Email OTP delivery was not recorded');
      }
      return delivery.code;
    }
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
      const deliveryCount = localEmailSender.getDeliveries().length;
      await emailDispatcher.dispatchOnce();
      const delivery = localEmailSender
        .getDeliveries()
        .slice(deliveryCount)
        .reverse()
        .find((candidate) => candidate.toEmail === email);
      if (delivery === undefined) {
        throw new Error('Conversion account OTP was not delivered');
      }
      const verified = await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ email, code: delivery.code })
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
      expect(
        await app
          .get(LocalObjectStorage)
          .exists(conversion?.uploadObjectKey ?? ''),
      ).toBe(false);

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
      const deliveryCount = localEmailSender.getDeliveries().length;
      await emailDispatcher.dispatchOnce();
      const delivery = localEmailSender
        .getDeliveries()
        .slice(deliveryCount)
        .reverse()
        .find((candidate) => candidate.toEmail === email);
      if (delivery === undefined) {
        throw new Error('Email OTP delivery was not recorded');
      }
      const verified = await request(httpServer)
        .post('/v1/auth/email/verify')
        .send({ email, code: delivery.code })
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

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
