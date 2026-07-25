import { apiFetch } from './apiFetch';
import type { AnalyticsGameplayEvent } from '../analytics/schema';

export class GameplayEventSyncError extends Error {
  constructor(readonly status: number) {
    super(`Analytics gameplay event flush failed: status ${status}`);
    this.name = 'GameplayEventSyncError';
  }
}

export async function postAnalyticsGameplayEvents(
  events: readonly AnalyticsGameplayEvent[],
): Promise<void> {
  const response = await apiFetch('/v1/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      events: events.map(({ eventId, occurredAt, kind, payload }) => ({
        eventId,
        occurredAt,
        kind,
        payload,
      })),
    }),
  });
  if (response.status !== 202) {
    throw new GameplayEventSyncError(response.status);
  }
  const result = (await response.json()) as unknown;
  if (
    typeof result !== 'object'
    || result === null
    || !('accepted' in result)
    || result.accepted !== true
  ) {
    throw new GameplayEventSyncError(response.status);
  }
}
