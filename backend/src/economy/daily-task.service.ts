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
      // Gather distinct sessionIds from events
      const sessionIds = Array.from(new Set(events.map(e => e.sessionId)));
      let ownedSessionIds = new Set<string>();
      if (sessionIds.length > 0) {
        const ownedRows = await manager.query<{ id: string }[]>(
          `SELECT id FROM sessions.stitching_sessions
           WHERE id = ANY($1::uuid[])
             AND principal_type = $2
             AND principal_id = $3`,
          [sessionIds, ledgerPrincipal.type, principal.id]
        );
        ownedSessionIds = new Set(ownedRows.map(r => r.id));
      }

      const invalidEventIds = new Set<string>();
      const nowMs = Date.now();

      // Check future events
      for (const event of events) {
        if (event.occurredAt) {
          const occurredAtVal = new Date(event.occurredAt);
          if (occurredAtVal.getTime() > nowMs + 60000) { // 60 seconds tolerance for clock skew
            invalidEventIds.add(event.eventId);
            this.logger.warn(`Rejecting event ${event.eventId} because occurredAt is in the future: ${event.occurredAt}`);
          }
        }
      }

      // Group stitch actions by sessionId to apply the velocity check
      const stitchActionsBySession = new Map<string, GameplayEventDto[]>();
      for (const event of events) {
        if (event.kind === 'stitch_action' && ownedSessionIds.has(event.sessionId) && !invalidEventIds.has(event.eventId)) {
          let list = stitchActionsBySession.get(event.sessionId);
          if (!list) {
            list = [];
            stitchActionsBySession.set(event.sessionId, list);
          }
          list.push(event);
        }
      }

      // Velocity Check (AC for Gap 2): Reject stitch actions that are denser than physically plausible.
      // We define the physical limit of manual stitching at 50 milliseconds (0.05 seconds) per stitch.
      // Any consecutive stitch actions in the same session with a time delta less than 50ms are dropped/skipped.
      for (const [sessionId, sessionEvents] of stitchActionsBySession.entries()) {
        const sorted = [...sessionEvents].sort((a, b) => {
          const aTime = a.occurredAt ? new Date(a.occurredAt).getTime() : nowMs;
          const bTime = b.occurredAt ? new Date(b.occurredAt).getTime() : nowMs;
          return aTime - bTime;
        });

        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1];
          const curr = sorted[i];
          const prevTime = prev.occurredAt ? new Date(prev.occurredAt).getTime() : nowMs;
          const currTime = curr.occurredAt ? new Date(curr.occurredAt).getTime() : nowMs;
          if (currTime - prevTime < 50) {
            invalidEventIds.add(curr.eventId);
            this.logger.warn(
              `Rejecting event ${curr.eventId} in session ${sessionId} due to velocity limit (delta: ${currTime - prevTime}ms)`
            );
          }
        }
      }

      const affectedRewardDays = new Set<string>();

      // For each owned, valid event:
      for (const event of events) {
        if (!ownedSessionIds.has(event.sessionId) || invalidEventIds.has(event.eventId)) {
          continue;
        }

        const occurredAtVal = event.occurredAt ? new Date(event.occurredAt) : null;
        // Derive each event's Reward Day from its own evidence (occurredAt) if present, otherwise fallback to server time
        const eventRewardDay = occurredAtVal ? utcRewardDay(occurredAtVal) : utcRewardDay();
        affectedRewardDays.add(eventRewardDay);

        const insertResult = await manager.query<{ event_id: string }[]>(
          `INSERT INTO economy.gameplay_events
             (event_id, principal_type, principal_id, reward_day, kind, session_id, dmc_code, client_seq, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT ON CONSTRAINT "PK_gameplay_events" DO NOTHING
           RETURNING event_id`,
          [
            event.eventId,
            ledgerPrincipal.type,
            ledgerPrincipal.id,
            eventRewardDay,
            event.kind,
            event.sessionId,
            event.dmcCode,
            event.clientSeq,
            occurredAtVal,
          ]
        );

        const inserted = insertResult.length > 0;

        if (inserted && event.kind === 'stitch_action') {
          // Upsert the color counter
          await manager.query(
            `INSERT INTO economy.daily_color_action_counts
               (principal_type, principal_id, reward_day, dmc_code, action_count)
             VALUES ($1, $2, $3, $4, 1)
             ON CONFLICT ON CONSTRAINT "PK_daily_color_action_counts"
               DO UPDATE SET action_count = economy.daily_color_action_counts.action_count + 1,
                             updated_at = now()`,
            [
              ledgerPrincipal.type,
              ledgerPrincipal.id,
              eventRewardDay,
              event.dmcCode,
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
