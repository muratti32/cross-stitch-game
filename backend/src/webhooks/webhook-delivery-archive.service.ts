import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { scrubWebhookPayload } from '../observability';
import type { JsonObject, JsonValue } from '../jobs/jobs.types';
import {
  WebhookDeliveryArchiveEntity,
  WebhookProcessingOutcome,
  WebhookProvider,
  WebhookVerificationResult,
} from './webhook-delivery-archive.entity';

export interface ArchiveWebhookDeliveryInput {
  provider: WebhookProvider;
  providerDeliveryId?: string | null;
  verificationResult: WebhookVerificationResult;
  processingOutcome: WebhookProcessingOutcome;
  failureReason?: string | null;
  payload: unknown;
}

@Injectable()
export class WebhookDeliveryArchiveService {
  private readonly logger = new Logger(WebhookDeliveryArchiveService.name);

  constructor(
    @InjectRepository(WebhookDeliveryArchiveEntity)
    private readonly deliveries: Repository<WebhookDeliveryArchiveEntity>,
  ) {}

  async archive(input: ArchiveWebhookDeliveryInput): Promise<void> {
    try {
      await this.deliveries.save(
        this.deliveries.create({
          failureReason: cappedReason(input.failureReason),
          payload: toJsonObject(scrubWebhookPayload(input.payload)),
          processingOutcome: input.processingOutcome,
          provider: input.provider,
          providerDeliveryId: input.providerDeliveryId ?? null,
          verificationResult: input.verificationResult,
        }),
      );
    } catch (error: unknown) {
      this.logger.error(
        `Unable to archive ${input.provider} webhook delivery: ${messageOf(error)}`,
      );
    }
  }

  async listRecent(filters: {
    provider?: WebhookProvider;
    outcome?: WebhookProcessingOutcome;
  }): Promise<WebhookDeliveryArchiveEntity[]> {
    const query = this.deliveries.createQueryBuilder('delivery')
      .orderBy('delivery.receivedAt', 'DESC')
      .take(100);
    if (filters.provider !== undefined) {
      query.andWhere('delivery.provider = :provider', { provider: filters.provider });
    }
    if (filters.outcome !== undefined) {
      query.andWhere('delivery.processingOutcome = :outcome', { outcome: filters.outcome });
    }
    return query.getMany();
  }

  async findById(id: string): Promise<WebhookDeliveryArchiveEntity | null> {
    return this.deliveries.findOneBy({ id });
  }

  async recordReplay(
    id: string,
    operatorId: string,
    outcome: WebhookProcessingOutcome,
    failureReason: string | null,
  ): Promise<void> {
    await this.deliveries.increment({ id }, 'replayCount', 1);
    await this.deliveries.update(
      { id },
      {
        lastReplayedAt: new Date(),
        lastReplayFailureReason: cappedReason(failureReason),
        lastReplayOutcome: outcome,
        lastReplayedByOperatorId: operatorId,
      },
    );
  }

  async purgeBefore(before: Date): Promise<number> {
    const result = await this.deliveries
      .createQueryBuilder()
      .delete()
      .where('received_at < :before', { before })
      .execute();
    return result.affected ?? 0;
  }
}

// failure_reason is varchar(512). An upstream error message can be longer than
// that (a provider HTTP body quoted into a message, a driver error), and letting
// Postgres reject the insert would lose the whole archive row - which is exactly
// the row an operator needs when something failed.
const MAX_FAILURE_REASON_LENGTH = 512;

function cappedReason(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined || reason.length === 0) {
    return null;
  }
  return reason.length > MAX_FAILURE_REASON_LENGTH
    ? reason.slice(0, MAX_FAILURE_REASON_LENGTH)
    : reason;
}

function toJsonObject(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { value: toJsonValue(value) };
  }
  return toJsonValue(value) as JsonObject;
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }
  if (typeof value === 'object') {
    const out: JsonObject = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toJsonValue(entry);
    }
    return out;
  }
  return `[unsupported webhook value of type ${typeof value}]`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
