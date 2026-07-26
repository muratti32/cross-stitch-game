import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { StartedTestContainer } from 'testcontainers';

import { postgresContainerKey, redisContainerKey } from './global-setup';

export default async function globalTeardown(): Promise<void> {
  const g = globalThis as Record<symbol, unknown>;
  const postgres = g[postgresContainerKey] as StartedPostgreSqlContainer | undefined;
  const redis = g[redisContainerKey] as StartedTestContainer | undefined;

  const cleanups = [];
  if (postgres !== undefined) {
    cleanups.push(postgres.stop());
  }
  if (redis !== undefined) {
    cleanups.push(redis.stop());
  }

  const results = await Promise.allSettled(cleanups);
  const rejections = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );

  if (rejections.length > 0) {
    throw rejections[0].reason;
  }
}
