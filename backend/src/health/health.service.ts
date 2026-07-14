import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';

import { AppConfigService } from '../config/app-config.service';
import type { DependencyStatus, HealthResponse } from './health.types';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
  ) {}

  async getHealth(): Promise<HealthResponse> {
    const [postgres, redis] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
    ]);

    return {
      checks: { postgres, redis },
      status: postgres === 'up' && redis === 'up' ? 'ok' : 'degraded',
    };
  }

  private async checkPostgres(): Promise<DependencyStatus> {
    try {
      await this.dataSource.query<readonly { connected: number }[]>(
        'SELECT 1 AS connected',
      );
      return 'up';
    } catch (error: unknown) {
      this.logFailure('PostgreSQL', error);
      return 'down';
    }
  }

  private async checkRedis(): Promise<DependencyStatus> {
    const redis = new Redis(this.config.redisUrl, {
      connectTimeout: 2_000,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });

    try {
      await redis.connect();
      const response = await redis.ping();

      if (response !== 'PONG') {
        throw new Error('Redis PING returned an unexpected response');
      }

      return 'up';
    } catch (error: unknown) {
      this.logFailure('Redis', error);
      return 'down';
    } finally {
      redis.disconnect();
    }
  }

  private logFailure(dependency: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(`${dependency} health check failed: ${message}`, stack);
  }
}
