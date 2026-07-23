import { timingSafeEqual } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';

/**
 * Verifies RevenueCat webhook request authenticity using a configured shared secret.
 * RevenueCat sends this secret in the Authorization header.
 */
@Injectable()
export class RevenueCatWebhookVerifierService {
  constructor(private readonly config: AppConfigService) {}

  verify(authorizationHeader: string | undefined): void {
    const expected = this.config.revenueCatWebhookAuthToken;
    if (expected === undefined) {
      // Fail closed: an unconfigured secret must never be treated as "any
      // caller is trusted" (this environment hasn't provisioned RevenueCat
      // yet — see docs/app-metadata.md).
      throw new UnauthorizedException('RevenueCat webhook is not configured');
    }
    if (
      typeof authorizationHeader !== 'string' ||
      authorizationHeader.length === 0
    ) {
      throw new UnauthorizedException('Missing RevenueCat webhook authorization');
    }
    // RevenueCat sends the configured value directly (optionally as
    // "Bearer <token>" if you configure it that way in the dashboard) — accept
    // an optional "Bearer " prefix for flexibility, then constant-time compare.
    const provided = authorizationHeader.startsWith('Bearer ')
      ? authorizationHeader.slice('Bearer '.length)
      : authorizationHeader;
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    const valid = a.length === b.length && timingSafeEqual(a, b);
    if (!valid) {
      throw new UnauthorizedException('Invalid RevenueCat webhook authorization');
    }
  }
}
