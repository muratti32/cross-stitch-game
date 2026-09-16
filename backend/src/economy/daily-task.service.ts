import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { AuthPrincipal } from '../auth/auth.types';
import { PrincipalType } from '../auth/entities';
import { CoinLedgerRepository, LedgerPrincipal } from './coin-ledger.repository';
import { GameplayEventDto } from './daily-task.dto';
import {
  DAILY_TASK_CELLS_TARGET,
  DAILY_TASK_COLOR_ACTIONS_MIN,
  DAILY_TASK_DISTINCT_COLORS_TARGET,
  DAILY_TASK_KEYS,
  DailyTaskKey,
} from './economy.constants';
import { nextRewardDayResetAt, utcRewardDay } from './reward-day';

export interface DailyTaskStatus {
  key: DailyTaskKey;
  target: number;
  progress: number;   // capped at target for display
  completed: boolean; // threshold met
  granted: boolean;   // coin already granted this Reward Day
}

export interface DailyTaskBoardView {
  rewardDay: string;
  resetsAt: string;
  balance: number;
  tasks: DailyTaskStatus[];
}

/** Shared by the future check and the Stitching Session lower bound (ADR-0064). */
const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/**
 * A `GameplayEventDto` known to be owned, not future-dated, and stamped with
 * its own Reward Day. `eventId`/`sessionId` are lowercased because Postgres
 * returns uuid columns lowercase, and `occurredAt` is parsed once into
 * `occurredAtDate` so the stored value and the derived Reward Day agree.
 */
type ValidEvent = Omit<GameplayEventDto, 'occurredAt'> & {
  eventRewardDay: string;
  occurredAtDate: Date | null;
};

@Injectable()
export class DailyTaskService {
  private readonly logger = new Logger(DailyTaskService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: CoinLedgerRepository,
  ) {}

  async getBoard(principal: AuthPrincipal): Promise<DailyTaskBoardView> {
    const ledgerPrincipal = toLedgerPrincipal(principal);
    const rewardDay = utcRewardDay();

    const [balance, progress, grantedKeys] = await Promise.all([
      this.ledger.getBalance(ledgerPrincipal),
      this.readProgress(this.dataSource.manager, ledgerPrincipal, rewardDay),
      this.ledger.grantedDailyTaskKeys(this.dataSource.manager, ledgerPrincipal, rewardDay),
    ]);

    return this.buildBoard(rewardDay, balance, progress, grantedKeys);
  }
  async ingest(principal: AuthPrincipal, events: GameplayEventDto[]): Promise<DailyTaskBoardView> {
    const ledgerPrincipal = toLedgerPrincipal(principal);

    return this.dataSource.transaction(async (manager) => {
      // Lowercased sessionIds (see ValidEvent). Ownership and each session's
      // creation time (the ADR-0064 lower bound) come from the same query.
      const sessionIds = Array.from(new Set(events.map(e => e.sessionId.toLowerCase())));
      const sessionCreatedAt = new Map<string, Date>();
      if (sessionIds.length > 0) {
        const ownedRows = await manager.query<{ id: string; created_at: Date }[]>(
          `SELECT id, created_at FROM sessions.stitching_sessions
           WHERE id = ANY($1::uuid[])
             AND principal_type = $2
             AND principal_id = $3`,
          [sessionIds, ledgerPrincipal.type, principal.id]
        );
        for (const row of ownedRows) {
          sessionCreatedAt.set(row.id, new Date(row.created_at));
        }
      }

      const invalidEventIds = new Set<string>();
      const nowMs = Date.now();

      // Check future events. Keyed by the lowercased eventId (see ValidEvent)
      // so a differently-cased copy of the same id is still caught below.
      for (const event of events) {
        if (event.occurredAt) {
          const occurredAtVal = new Date(event.occurredAt);
          if (occurredAtVal.getTime() > nowMs + CLOCK_SKEW_TOLERANCE_MS) {
            invalidEventIds.add(event.eventId.toLowerCase());
            this.logger.warn(`Rejecting event ${event.eventId} because occurredAt is in the future: ${event.occurredAt}`);
          }
        }
      }

      // No per-event velocity floor runs here. A Stitch Sweep produces one
      // Stitch Action for every newly filled cell within a single gesture, so
      // consecutive stitch evidence is legitimately milliseconds apart. The
      // 50 ms physical floor of ADR-0062 is an aggregate over a whole session
      // and belongs to the Completion Claim validator, not to Daily Task
      // evidence; Daily Task evidence is bounded by authentication, session
      // ownership, and eventId deduplication instead (ADR-0063), and
      // Stitching Session creation (ADR-0064).

      const affectedRewardDays = new Set<string>();
      // First occurrence wins; without this a duplicate eventId would be
      // counted twice in the aggregation below.
      const dedupedValidEvents = new Map<string, ValidEvent>();

      // For each owned, valid event:
      let belowSessionCreationCount = 0;
      const belowSessionCreationSessionIds = new Set<string>();
      for (const event of events) {
        const sessionId = event.sessionId.toLowerCase();
        const eventId = event.eventId.toLowerCase();
        const sessionCreated = sessionCreatedAt.get(sessionId);
        if (!sessionCreated || invalidEventIds.has(eventId)) {
          continue;
        }

        // Parsed once so it and the Reward Day below agree (see ValidEvent).
        const occurredAtDate = event.occurredAt ? new Date(event.occurredAt) : null;

        // Evidence can't predate the Stitching Session it's evidence for
        // (ADR-0064); tolerate the same clock skew as the future check.
        if (occurredAtDate && occurredAtDate.getTime() < sessionCreated.getTime() - CLOCK_SKEW_TOLERANCE_MS) {
          belowSessionCreationCount++;
          belowSessionCreationSessionIds.add(sessionId);
          continue;
        }

        // Derive each event's Reward Day from its own evidence (occurredAt) if present, otherwise fallback to server time
        const eventRewardDay = occurredAtDate ? utcRewardDay(occurredAtDate) : utcRewardDay();
        affectedRewardDays.add(eventRewardDay);

        if (!dedupedValidEvents.has(eventId)) {
          dedupedValidEvents.set(eventId, { ...event, eventId, sessionId, eventRewardDay, occurredAtDate });
        }
      }

      if (belowSessionCreationCount > 0) {
        this.logger.warn(
          `Rejected ${belowSessionCreationCount} event(s) dated before their Stitching Session's creation, session(s): ${[...belowSessionCreationSessionIds].join(', ')}`,
        );
      }

      const validEvents = [...dedupedValidEvents.values()];

      if (validEvents.length > 0) {
        const insertedRows = await manager.query<{ event_id: string }[]>(
          `INSERT INTO economy.gameplay_events
             (event_id, principal_type, principal_id, reward_day, kind, session_id, dmc_code, client_seq, occurred_at)
           SELECT e.event_id, $1, $2, e.reward_day, e.kind, e.session_id, e.dmc_code, e.client_seq, e.occurred_at
           FROM unnest($3::uuid[], $4::date[], $5::varchar[], $6::uuid[], $7::varchar[], $8::bigint[], $9::timestamptz[])
             AS e(event_id, reward_day, kind, session_id, dmc_code, client_seq, occurred_at)
           ON CONFLICT ON CONSTRAINT "PK_gameplay_events" DO NOTHING
           RETURNING event_id`,
          [
            ledgerPrincipal.type,
            ledgerPrincipal.id,
            validEvents.map((e) => e.eventId),
            validEvents.map((e) => e.eventRewardDay),
            validEvents.map((e) => e.kind),
            validEvents.map((e) => e.sessionId),
            validEvents.map((e) => e.dmcCode),
            validEvents.map((e) => e.clientSeq),
            validEvents.map((e) => e.occurredAtDate),
          ]
        );

        const insertedEventIds = new Set(insertedRows.map((r) => r.event_id));

        // Aggregate inserted stitch_action events by (reward_day, dmc_code) so
        // each key appears at most once in the upsert statement below.
        const colorCountDeltas = new Map<string, { rewardDay: string; dmcCode: string; count: number }>();
        for (const event of validEvents) {
          if (!insertedEventIds.has(event.eventId) || event.kind !== 'stitch_action') {
            continue;
          }
          const key = `${event.eventRewardDay}|${event.dmcCode}`;
          const existing = colorCountDeltas.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            colorCountDeltas.set(key, { rewardDay: event.eventRewardDay, dmcCode: event.dmcCode, count: 1 });
          }
        }

        const deltas = [...colorCountDeltas.values()];
        if (deltas.length > 0) {
          await manager.query(
            `INSERT INTO economy.daily_color_action_counts
               (principal_type, principal_id, reward_day, dmc_code, action_count)
             SELECT $1, $2, e.reward_day, e.dmc_code, e.action_count
             FROM unnest($3::date[], $4::varchar[], $5::integer[]) AS e(reward_day, dmc_code, action_count)
             ON CONFLICT ON CONSTRAINT "PK_daily_color_action_counts"
               DO UPDATE SET action_count = economy.daily_color_action_counts.action_count + EXCLUDED.action_count,
                             updated_at = now()`,
            [
              ledgerPrincipal.type,
              ledgerPrincipal.id,
              deltas.map((d) => d.rewardDay),
              deltas.map((d) => d.dmcCode),
              deltas.map((d) => d.count),
            ]
          );
        }
      }

      // Check completions and grant daily tasks for all affected days
      for (const affectedDay of affectedRewardDays) {
        const progress = await this.readProgress(manager, ledgerPrincipal, affectedDay);

        const cells_100_completed = progress.totalActions >= DAILY_TASK_CELLS_TARGET;
        const three_colors_10_completed = progress.distinctColorsAtThreshold >= DAILY_TASK_DISTINCT_COLORS_TARGET;
        const color_completion_completed = progress.hasColorCompletion;

        const granted = await this.ledger.grantedDailyTaskKeys(manager, ledgerPrincipal, affectedDay);

        for (const key of DAILY_TASK_KEYS) {
          let isCompleted = false;
          if (key === 'cells_100') {
            isCompleted = cells_100_completed;
          } else if (key === 'three_colors_10') {
            isCompleted = three_colors_10_completed;
          } else if (key === 'color_completion') {
            isCompleted = color_completion_completed;
          }

          if (isCompleted && !granted.has(key)) {
            await this.ledger.grantDailyTask(manager, ledgerPrincipal, affectedDay, key);
          }
        }
      }

      // Build and return the board for the current server reward day
      const currentRewardDay = utcRewardDay();
      const finalProgress = await this.readProgress(manager, ledgerPrincipal, currentRewardDay);
      const finalGranted = await this.ledger.grantedDailyTaskKeys(manager, ledgerPrincipal, currentRewardDay);

      const balanceRows = await manager.query<{ balance: string }[]>(
        `SELECT balance FROM economy.coin_balances WHERE principal_type = $1 AND principal_id = $2`,
        [ledgerPrincipal.type, ledgerPrincipal.id]
      );
      const currentBalance = balanceRows.length === 0 ? 0 : Number(balanceRows[0].balance);

      return this.buildBoard(currentRewardDay, currentBalance, finalProgress, finalGranted);
    });
  }

  private async readProgress(
    manager: EntityManager,
    principal: LedgerPrincipal,
    rewardDay: string,
  ): Promise<{
    totalActions: number;
    distinctColorsAtThreshold: number;
    hasColorCompletion: boolean;
  }> {
    const colorCounts = await manager.query<{ action_count: number }[]>(
      `SELECT action_count
       FROM economy.daily_color_action_counts
       WHERE principal_type = $1
         AND principal_id = $2
         AND reward_day = $3`,
      [principal.type, principal.id, rewardDay],
    );

    let totalActions = 0;
    let distinctColorsAtThreshold = 0;
    for (const row of colorCounts) {
      const count = Number(row.action_count);
      totalActions += count;
      if (count >= DAILY_TASK_COLOR_ACTIONS_MIN) {
        distinctColorsAtThreshold += 1;
      }
    }

    const completionRows = await manager.query<{ exists: boolean }[]>(
      `SELECT EXISTS(
         SELECT 1
         FROM economy.gameplay_events
         WHERE principal_type = $1
           AND principal_id = $2
           AND reward_day = $3
           AND kind = 'color_completion'
       ) AS "exists"`,
      [principal.type, principal.id, rewardDay],
    );
    const hasColorCompletion = completionRows[0]?.exists ?? false;

    return {
      totalActions,
      distinctColorsAtThreshold,
      hasColorCompletion,
    };
  }

  private buildBoard(
    rewardDay: string,
    balance: number,
    progress: {
      totalActions: number;
      distinctColorsAtThreshold: number;
      hasColorCompletion: boolean;
    },
    grantedKeys: Set<string>,
  ): DailyTaskBoardView {
    const tasks: DailyTaskStatus[] = [];

    for (const key of DAILY_TASK_KEYS) {
      let target = 0;
      let currentProgress = 0;
      let completed = false;

      if (key === 'cells_100') {
        target = DAILY_TASK_CELLS_TARGET;
        currentProgress = Math.min(progress.totalActions, target);
        completed = progress.totalActions >= target;
      } else if (key === 'three_colors_10') {
        target = DAILY_TASK_DISTINCT_COLORS_TARGET;
        currentProgress = Math.min(progress.distinctColorsAtThreshold, target);
        completed = progress.distinctColorsAtThreshold >= target;
      } else if (key === 'color_completion') {
        target = 1;
        currentProgress = progress.hasColorCompletion ? 1 : 0;
        completed = progress.hasColorCompletion;
      }

      tasks.push({
        key,
        target,
        progress: currentProgress,
        completed,
        granted: grantedKeys.has(key),
      });
    }

    return {
      rewardDay,
      resetsAt: nextRewardDayResetAt().toISOString(),
      balance,
      tasks,
    };
  }
}

function toLedgerPrincipal(principal: AuthPrincipal): LedgerPrincipal {
  return {
    type: principal.type === PrincipalType.Account ? 'account' : 'guest',
    id: principal.id,
  };
}
