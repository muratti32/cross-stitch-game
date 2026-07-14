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
import { DataSource } from 'typeorm';

import { configureApi } from '../src/api/configure-api';
import { CatalogService } from '../src/catalog/catalog.service';
import { encodePatternArtifactV1 } from '../src/catalog/pattern-artifact-encoder';
import { LocalObjectStorage } from '../src/catalog/storage/local-object-storage';
import { SessionsService } from '../src/sessions/sessions.service';
import { StorageReconcilerService } from '../src/sessions/storage-reconciler.service';
import {
  GuestInstallationEntity,
  GuestInstallationStatus,
  PrincipalType,
  RefreshTokenEntity,
  RefreshTokenStatus,
} from '../src/auth/entities';
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

  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalJwtAccessTtlSeconds = process.env.JWT_ACCESS_TTL_SECONDS;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalRedisUrl = process.env.REDIS_URL;
  const originalRefreshTokenTtlSeconds =
    process.env.REFRESH_TOKEN_TTL_SECONDS;
  const originalPort = process.env.PORT;

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
    const moduleRef = await Test.createTestingModule({
      imports: [ApiAppModule, jobs.JobsWorkerModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApi(app);
    await app.init();

    httpServer = app.getHttpServer() as Server;
    dataSource = app.get(DataSource);
    processingJobs = app.get(jobs.ProcessingJobsRepository);
    dispatcher = app.get(jobs.OutboxDispatcherService);
    queue = app.get(jobs.DemoJobsQueueService);
    consumer = app.get(jobs.DemoJobConsumerService);
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
