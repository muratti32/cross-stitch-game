import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Server } from 'node:http';
import request from 'supertest';
import {
  GenericContainer,
  StartedTestContainer,
} from 'testcontainers';
import { DataSource } from 'typeorm';

import { configureApi } from '../src/api/configure-api';
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
  const originalRedisUrl = process.env.REDIS_URL;
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
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
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
    restoreEnvironment('REDIS_URL', originalRedisUrl);
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

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
