import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class EmailOtpRateLimiterService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(private readonly config: AppConfigService) {
    this.redis = new Redis(config.redisUrl, {
      connectTimeout: 5_000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
  }

  consumeEmail(email: string): Promise<boolean> {
    return this.consume(
      'email',
      email,
      this.emailLimit,
      this.windowSeconds,
    );
  }

  consumeIp(ip: string): Promise<boolean> {
    return this.consume('ip', ip, this.ipLimit, this.windowSeconds);
  }

  async consume(
    namespace: 'email' | 'ip',
    subject: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const currentSecond = Math.floor(Date.now() / 1_000);
    const window = Math.floor(currentSecond / windowSeconds);
    const expiresInSeconds = windowSeconds - (currentSecond % windowSeconds);
    const key = `email-otp:${namespace}:${window}:${subject}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, expiresInSeconds);
    }
    return count <= limit;
  }

  onModuleDestroy(): Promise<'OK'> {
    return this.redis.quit();
  }

  private get emailLimit(): number {
    return this.config.emailOtpRateLimitPerEmail;
  }

  private get ipLimit(): number {
    return this.config.emailOtpRateLimitPerIp;
  }

  private get windowSeconds(): number {
    return this.config.emailOtpTtlSeconds;
  }
}
