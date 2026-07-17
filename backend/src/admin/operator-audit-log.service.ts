import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import type { JsonObject, JsonValue } from '../jobs/jobs.types';
import { OperatorAuditLogEntity, OperatorAuditOutcome } from './entities';

export interface RecordAuditLogInput {
  operatorAccountId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  outcome: OperatorAuditOutcome;
}

const REDACTED = '[redacted]';
const SENSITIVE_KEY_PATTERN =
  /password|secret|totp|recoverycode|recovery_code|token|credential|hash|bytes|imagedata|image_data/i;

/**
 * Deep-redacts anything that looks like a credential, secret, or raw image
 * payload before it is written to the append-only audit log, so callers
 * cannot accidentally leak them by passing a domain object as-is.
 */
export function redactAuditValue(value: unknown): JsonValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `[redacted:${value.length}-bytes]`;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactAuditValue(entry));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    const out: JsonObject = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactAuditValue(entry);
    }
    return out;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  // Only bigint, symbol, or function values reach here; none are meaningful
  // audit content, so record their kind rather than risk a lossy `String()`
  // conversion (also avoids relying on Object.prototype's toString).
  if (typeof value === 'bigint' || typeof value === 'symbol') {
    return value.toString();
  }
  return `[unsupported audit value of type ${typeof value}]`;
}

function redactRecord(value: unknown): JsonObject | null {
  if (value === null || value === undefined) {
    return null;
  }
  return redactAuditValue(value) as JsonObject;
}

@Injectable()
export class OperatorAuditLogService {
  /**
   * Callers pass the EntityManager of their own ongoing transaction so this
   * row commits atomically with the domain mutation it records (ADR-0039).
   */
  async record(
    manager: EntityManager,
    input: RecordAuditLogInput,
  ): Promise<void> {
    const repository = manager.getRepository(OperatorAuditLogEntity);
    await repository.save(
      repository.create({
        action: input.action,
        after: redactRecord(input.after),
        before: redactRecord(input.before),
        operatorAccountId: input.operatorAccountId,
        outcome: input.outcome,
        requestId: input.requestId ?? null,
        targetId: input.targetId ?? null,
        targetType: input.targetType,
      }),
    );
  }
}
