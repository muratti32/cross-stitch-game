import { Controller, Get, HttpCode, HttpStatus, Req } from '@nestjs/common';
import type { Request } from 'express';

import { RewardGrantService } from './reward-grant.service';

/**
 * AdMob Server-Side Verification callback (ADR-0033). AdMob calls this endpoint
 * directly with a signed GET request, so it is intentionally unauthenticated —
 * trust comes from the signature, not a JWT. A decided callback always returns
 * 200 so AdMob does not retry it; only a missing/invalid signature or malformed
 * payload yields 400 (surfaced by the services as BadRequestException).
 */
@Controller('admob')
export class AdMobSsvController {
  constructor(private readonly rewardGrant: RewardGrantService) {}

  @Get('ssv')
  @HttpCode(HttpStatus.OK)
  async verify(@Req() request: Request): Promise<{
    status: 'ok';
    granted: boolean;
    replayed: boolean;
  }> {
    const separator = request.url.indexOf('?');
    const rawQuery =
      separator < 0 ? '' : request.url.slice(separator + 1);

    const result = await this.rewardGrant.processAdCallback(rawQuery);
    return {
      status: 'ok',
      granted: result.granted,
      replayed: result.replayed,
    };
  }
}
