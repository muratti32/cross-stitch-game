import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { AppConfigService } from '../config/app-config.service';
import {
  OPERATOR_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  OPERATOR_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  OPERATOR_MFA_RATE_LIMIT_MAX_ATTEMPTS,
  OPERATOR_MFA_RATE_LIMIT_WINDOW_SECONDS,
} from './admin.constants';

@Injectable()
export class OperatorAuthRateLimiterService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(config: AppConfigService) {
    this.redis = new Redis(config.redisUrl, {
      connectTimeout: 5_000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
  }

  consumeLoginAttempt(subject: string): Promise<boolean> {
    return this.consume(
      'login',
      subject,
      OPERATOR_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
      OPERATOR_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    );
  }

  consumeMfaAttempt(subject: string): Promise<boolean> {
    return this.consume(
      'mfa',
      subject,
      OPERATOR_MFA_RATE_LIMIT_MAX_ATTEMPTS,
      OPERATOR_MFA_RATE_LIMIT_WINDOW_SECONDS,
    );
  }

  private async consume(
    namespace: 'login' | 'mfa',
    subject: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const currentSecond = Math.floor(Date.now() / 1_000);
    const window = Math.floor(currentSecond / windowSeconds);
    const expiresInSeconds = windowSeconds - (currentSecond % windowSeconds);
    const key = `admin-auth:${namespace}:${window}:${subject}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, expiresInSeconds);
    }
    return count <= limit;
  }

  onModuleDestroy(): Promise<'OK'> {
    return this.redis.quit();
  }
}
