import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from './environment';

@Injectable()
export class AppConfigService {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  get databaseUrl(): string {
    return this.configService.get('DATABASE_URL', { infer: true });
  }

  get jwtAccessTtlSeconds(): number {
    return this.configService.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }

  get jwtSecret(): string {
    const secret = this.configService.get('JWT_SECRET', { infer: true });
    if (secret === undefined) {
      throw new Error('JWT_SECRET is required for the API deployable');
    }
    return secret;
  }

  get port(): number {
    return this.configService.get('PORT', { infer: true });
  }

  get redisUrl(): string {
    return this.configService.get('REDIS_URL', { infer: true });
  }

  get refreshTokenTtlSeconds(): number {
    return this.configService.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true });
  }
}
