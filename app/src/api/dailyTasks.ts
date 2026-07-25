import { apiFetch } from './apiFetch';
import { useQuery } from '@tanstack/react-query';

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

/** Fixed coin reward per Daily Task, locked by ADR-0011. Never returned by the API. */
export const DAILY_TASK_COIN = 10;

export type DailyTaskKey = 'cells_100' | 'three_colors_10' | 'color_completion';

export interface DailyTaskStatus {
  key: DailyTaskKey;
  target: number;
  progress: number;
  completed: boolean;
  granted: boolean;
}

export interface DailyTaskBoardView {
  rewardDay: string;
  resetsAt: string;
  balance: number;
  tasks: DailyTaskStatus[];
}

/**
 * Uploads a batch of Gameplay Events for the authenticated Guest or Account.
 * The endpoint has no @HttpCode override so Nest's default POST success
 * status is 201, not 200 — check 201 here, do not copy the 200 check from
 * progressSync.ts (that endpoint explicitly overrides to 200).
 */
export async function postGameplayEvents(events: GameplayEventPayload[]): Promise<DailyTaskBoardView | null> {
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
  // The board is only read to derive an analytics record. A body that will not
  // parse must not stop this batch of reward evidence from being acknowledged,
  // so the accepted upload still counts as accepted.
  try {
    return (await response.json()) as DailyTaskBoardView;
  } catch {
    return null;
  }
}

/**
 * Fetches the current Daily Task board for the authenticated Guest or Account.
 */
export async function fetchDailyTaskBoard(): Promise<DailyTaskBoardView> {
  const response = await apiFetch('/v1/economy/daily-tasks');
  if (!response.ok) {
    throw new DailyTaskSyncError(
      `Failed to fetch Daily Task board: status ${response.status}`,
      response.status,
    );
  }
  return (await response.json()) as DailyTaskBoardView;
}

/**
 * Set `enabled` only while the app has a backend-authenticated identity. Both
 * Guest and Registered Account ledgers receive the same task rewards.
 */
export function useDailyTaskBoard(enabled: boolean) {
  return useQuery({
    queryKey: ['economy', 'dailyTasks'],
    queryFn: fetchDailyTaskBoard,
    enabled,
  });
}
