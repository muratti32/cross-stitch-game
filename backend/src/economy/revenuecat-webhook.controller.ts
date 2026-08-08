import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';

import { RevenueCatWebhookVerifierService } from './revenuecat-webhook-verifier.service';
import { RevenueCatWebhookService } from './revenuecat-webhook.service';
import { WebhookDeliveryArchiveService } from '../webhooks';

/**
 * RevenueCat Webhook Controller (ADR-0032).
 * Receives webhook notifications from RevenueCat. Authenticates using a shared secret token
 * provided in the Authorization header. Returns HTTP 200 for settled business-rule
 * outcomes (e.g. unknown account) to prevent retry storms, throws 4xx for signature
 * issues or malformed payloads, and throws 503 for the one outcome that a later
 * delivery can still resolve: a transaction currently owned by another account.
 */
@Controller('commerce/revenuecat')
export class RevenueCatWebhookController {
  constructor(
    private readonly verifier: RevenueCatWebhookVerifierService,
    private readonly service: RevenueCatWebhookService,
    private readonly archive: WebhookDeliveryArchiveService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handle(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<{ status: 'ok' }> {
    const providerDeliveryId = revenueCatDeliveryId(body);
    try {
      this.verifier.verify(authorization);
    } catch (error: unknown) {
      await this.archive.archive({
        failureReason: errorMessage(error),
        payload: revenueCatArchivePayload(body),
        processingOutcome: 'verification_failed',
        provider: 'revenuecat',
        providerDeliveryId,
        verificationResult: 'failed',
      });
      throw error;
    }

    try {
      const outcome = await this.service.handleEvent(body);
      // A transaction owned by another account is not necessarily fraud:
      // RevenueCat delivers a subscription TRANSFER and the events of the
      // transferred subscription in no fixed order, so an event can arrive
      // moments before the transfer that makes it legitimate. Answering 200
      // would drop it for good, so ask for redelivery instead and let the
      // ownership guard decide again once the transfer has landed.
      if (outcome.detail === 'rejected_other_account') {
        await this.archive.archive({
          failureReason: 'rejected_other_account',
          payload: revenueCatArchivePayload(body),
          processingOutcome: 'failed',
          provider: 'revenuecat',
          providerDeliveryId,
          verificationResult: 'verified',
        });
        throw new ServiceUnavailableException(
          'Transaction ownership is unresolved; retry this delivery',
        );
      }
      await this.archive.archive({
        payload: revenueCatArchivePayload(body),
        processingOutcome: outcome.duplicate ? 'duplicate_ignored' : 'processed',
        provider: 'revenuecat',
        providerDeliveryId,
        verificationResult: 'verified',
      });
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      await this.archive.archive({
        failureReason: errorMessage(error),
        payload: revenueCatArchivePayload(body),
        processingOutcome: 'failed',
        provider: 'revenuecat',
        providerDeliveryId,
        verificationResult: 'verified',
      });
      throw error;
    }
    return { status: 'ok' };
  }
}

function revenueCatDeliveryId(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const event = (body as Record<string, unknown>).event;
  if (event === null || typeof event !== 'object') return null;
  const source = event as Record<string, unknown>;
  const id = source.id;
  if (typeof id === 'string' && id.length > 0) return id;
  const transactionId = source.transaction_id;
  return typeof transactionId === 'string' && transactionId.length > 0
    ? transactionId
    : null;
}

function revenueCatArchivePayload(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object') return {};
  const event = (body as Record<string, unknown>).event;
  if (event === null || typeof event !== 'object') return {};
  const source = event as Record<string, unknown>;
  const allowed = [
    'id', 'type', 'app_user_id', 'transaction_id', 'original_transaction_id',
    'product_id', 'environment', 'period_type', 'event_timestamp_ms',
    'purchased_at_ms', 'expiration_at_ms', 'grace_period_expiration_at_ms',
    'cancel_reason',
  ];
  const archived: Record<string, unknown> = {};
  for (const key of allowed) {
    if (source[key] !== undefined) archived[key] = source[key];
  }
  return { event: archived };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Webhook verification failed';
}
