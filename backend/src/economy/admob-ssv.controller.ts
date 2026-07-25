import { Controller, Get, HttpCode, HttpStatus, Req } from '@nestjs/common';
import type { Request } from 'express';

import { RewardGrantService } from './reward-grant.service';
import { AdMobSsvVerifierService } from './admob-ssv-verifier.service';
import type { AdMobSsvReward } from './admob-ssv-verifier.service';
import { WebhookDeliveryArchiveService } from '../webhooks';

/**
 * AdMob Server-Side Verification callback (ADR-0033). AdMob calls this endpoint
 * directly with a signed GET request, so it is intentionally unauthenticated —
 * trust comes from the signature, not a JWT. A decided callback always returns
 * 200 so AdMob does not retry it; only a missing/invalid signature or malformed
 * payload yields 400 (surfaced by the services as BadRequestException).
 */
@Controller('admob')
export class AdMobSsvController {
  constructor(
    private readonly verifier: AdMobSsvVerifierService,
    private readonly rewardGrant: RewardGrantService,
    private readonly archive: WebhookDeliveryArchiveService,
  ) {}

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

    let reward: AdMobSsvReward;
    try {
      reward = await this.verifier.verify(rawQuery);
    } catch (error: unknown) {
      await this.archive.archive({
        failureReason: errorMessage(error),
        // The raw query includes AdMob's signature and must never be retained.
        payload: { callback: 'verification_failed' },
        processingOutcome: 'verification_failed',
        provider: 'admob',
        providerDeliveryId: null,
        verificationResult: 'failed',
      });
      throw error;
    }
    try {
      const result = await this.rewardGrant.processVerifiedAdCallback(reward);
      await this.archive.archive({
        payload: reward,
        processingOutcome: result.replayed ? 'duplicate_ignored' : 'processed',
        provider: 'admob',
        providerDeliveryId: reward.transactionId || null,
        verificationResult: 'verified',
      });
      return {
        status: 'ok',
        granted: result.granted,
        replayed: result.replayed,
      };
    } catch (error: unknown) {
      await this.archive.archive({
        failureReason: errorMessage(error),
        payload: reward,
        processingOutcome: 'failed',
        provider: 'admob',
        providerDeliveryId: reward.transactionId || null,
        verificationResult: 'verified',
      });
      throw error;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'AdMob callback failed';
}
