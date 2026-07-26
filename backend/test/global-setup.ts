import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { DataSource } from 'typeorm';

import { seedTestEnvironment } from './test-environment';

export const postgresContainerKey = Symbol.for('postgres-container');
export const redisContainerKey = Symbol.for('redis-container');

export default async function globalSetup(): Promise<void> {
  // 1. Seed test environment first to define NODE_ENV=test and prevent loading .env
  seedTestEnvironment();

  let postgresContainer: StartedPostgreSqlContainer | undefined;
  let redisContainer: StartedTestContainer | undefined;

  try {
    // 2. Start PostgreSQL container
    postgresContainer = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('stitch_wish_test')
      .withUsername('stitch_wish_test')
      .withPassword('stitch_wish_test')
      .start();

    // 3. Start Redis container
    const redisInstance = new GenericContainer('redis:7-alpine').withExposedPorts(6379);
    redisContainer = await redisInstance.start();

    // 4. Assign environment variables unconditionally
    const host = redisContainer.getHost();
    const mappedPort = redisContainer.getMappedPort(6379);
    process.env.DATABASE_URL = postgresContainer.getConnectionUri();
    process.env.REDIS_URL = `redis://${host}:${mappedPort}`;

    // 5. Run migrations. Must use dynamic import to prevent transitive evaluation of
    // AppConfigModule before seedTestEnvironment has executed.
    const { createTypeOrmOptions } = await import('../src/database/typeorm-options');
    const dataSource = new DataSource(createTypeOrmOptions(process.env.DATABASE_URL));
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.destroy();

    // Stash the containers on globalThis
    (globalThis as Record<symbol, unknown>)[postgresContainerKey] = postgresContainer;
    (globalThis as Record<symbol, unknown>)[redisContainerKey] = redisContainer;
  } catch (error: unknown) {
    // Clean up started containers on error before throwing
    const cleanups = [];
    if (postgresContainer !== undefined) {
      cleanups.push(postgresContainer.stop());
    }
    if (redisContainer !== undefined) {
      cleanups.push(redisContainer.stop());
    }
    await Promise.allSettled(cleanups);
    throw error;
  }
}
