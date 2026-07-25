import {
  enqueueAnalyticsGameplayEvent,
  generateUUID,
  getAnalyticsSessionId,
} from '../local-db';
import type {
  AnalyticsGameplayEventKind,
  AnalyticsGameplayEventPayload,
} from './schema';

/**
 * Persists an analytics event without allowing telemetry storage failures to
 * affect the player action that caused it. The generated id is written with
 * the event and is therefore stable for every later delivery retry.
 */
export async function captureGameplayEvent<K extends AnalyticsGameplayEventKind>(
  kind: K,
  payload: AnalyticsGameplayEventPayloadByKind<K>,
  dedupeKey?: string,
): Promise<void> {
  try {
    await enqueueAnalyticsGameplayEvent({
      eventId: generateUUID(),
      occurredAt: new Date().toISOString(),
      kind,
      payload,
      dedupeKey,
    });
  } catch {
    // Analytics must never prevent local play or a player-facing flow.
  }
}

export async function captureSessionGameplayEvent(
  kind: 'session_started' | 'session_completed',
  localSessionId: string,
  remoteSessionId: string | null | undefined,
): Promise<void> {
  try {
    await captureGameplayEvent(kind, {
      session_id: remoteSessionId ?? await getAnalyticsSessionId(localSessionId),
    });
  } catch {
    // Session analytics cannot interfere with entering or completing a session.
  }
}

type AnalyticsGameplayEventPayloadByKind<K extends AnalyticsGameplayEventKind> =
  Extract<AnalyticsGameplayEventPayload, { kind: K }>['payload'];
