import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { RevenueCatWebhookVerifierService } from './revenuecat-webhook-verifier.service';
import { RevenueCatWebhookService } from './revenuecat-webhook.service';

/**
 * RevenueCat Webhook Controller (ADR-0032).
 * Receives webhook notifications from RevenueCat. Authenticates using a shared secret token
 * provided in the Authorization header. Returns HTTP 200 for business-rule outcomes
 * (e.g. unknown account) to prevent retry storms, only throwing 4xx for signature issues
 * or malformed payloads.
 */
@Controller('commerce/revenuecat')
export class RevenueCatWebhookController {
  constructor(
    private readonly verifier: RevenueCatWebhookVerifierService,
    private readonly service: RevenueCatWebhookService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handle(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<{ status: 'ok' }> {
    this.verifier.verify(authorization);
    await this.service.handleEvent(body);
    return { status: 'ok' };
  }
}
