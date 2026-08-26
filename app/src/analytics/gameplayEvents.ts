import {
  enqueueAnalyticsGameplayEvent,
  generateUUID,
  getAnalyticsSessionId,
} from '../local-db';
import type {
  AnalyticsGameplayEventKind,
  AnalyticsGameplayEventPayload,
} from './schema';
import type { OnboardingPayloadBase } from './schema';

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

/** Onboarding telemetry is deliberately fire-and-forget and carries its version in payload. */
export async function captureOnboardingEvent<K extends Extract<AnalyticsGameplayEventKind, `onboarding_${string}` | `tutorial_${string}` | 'stitching_session_started' | 'account_soft_prompt_shown' | 'account_soft_prompt_action'>>(
  kind: K,
  payload: Omit<Extract<AnalyticsGameplayEventPayload, { kind: K }>['payload'], keyof OnboardingPayloadBase>,
  dedupeKey?: string,
): Promise<void> {
  await captureGameplayEvent(
    kind,
    { ...payload, onboarding_version: '1' } as unknown as AnalyticsGameplayEventPayloadByKind<K>,
    dedupeKey,
  );
}

type AnalyticsGameplayEventPayloadByKind<K extends AnalyticsGameplayEventKind> =
  Extract<AnalyticsGameplayEventPayload, { kind: K }>['payload'];
