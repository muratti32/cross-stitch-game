import { apiFetch } from './apiFetch';

export type GameplayEventKind = 'stitch_action' | 'color_completion';

export interface GameplayEventPayload {
  eventId: string;
  kind: GameplayEventKind;
  sessionId: string;
  dmcCode: string;
  clientSeq: number;
  occurredAt: string;
}

export class DailyTaskSyncError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DailyTaskSyncError';
    this.status = status;
  }
}

/**
 * Uploads a batch of Gameplay Events (account sessions only; guests 403).
 * The endpoint has no @HttpCode override so Nest's default POST success
 * status is 201, not 200 — check 201 here, do not copy the 200 check from
 * progressSync.ts (that endpoint explicitly overrides to 200).
 */
export async function postGameplayEvents(events: GameplayEventPayload[]): Promise<void> {
  const response = await apiFetch('/v1/economy/daily-tasks/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  if (response.status !== 201) {
    throw new DailyTaskSyncError(
      `Gameplay event flush failed: status ${response.status}`,
      response.status,
    );
  }
}
