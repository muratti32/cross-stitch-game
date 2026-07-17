import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { JsonObject } from '../jobs/jobs.types';
import {
  OperatorSecurityEventEntity,
  OperatorSecurityEventType,
} from './entities';

export interface RecordSecurityEventInput {
  operatorAccountId: string | null;
  eventType: OperatorSecurityEventType;
  detail?: JsonObject | null;
  ip?: string | null;
}

/**
 * Security events are always written through `this.dataSource.manager`
 * (never a manager handed in by a caller's ongoing transaction), so a
 * rolled-back domain mutation can never take a security event down with it
 * (ADR-0039: "committed independently").
 */
@Injectable()
export class OperatorSecurityEventsService {
  constructor(private readonly dataSource: DataSource) {}

  async record(input: RecordSecurityEventInput): Promise<void> {
    const repository = this.dataSource.getRepository(OperatorSecurityEventEntity);
    await repository.save(
      repository.create({
        detail: input.detail ?? null,
        eventType: input.eventType,
        ip: input.ip ?? null,
        operatorAccountId: input.operatorAccountId,
      }),
    );
  }
}
