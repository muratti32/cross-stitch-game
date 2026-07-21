import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { PrincipalType } from '../auth/entities';
import type { AuthPrincipal } from '../auth/auth.types';
import {
  mergeCellOperation,
  type CellStateValue,
} from './progress-merge';
import type {
  CompleteProgressDto,
  IncomingProgressOperationDto,
  ProgressSyncDto,
} from './progress-sync.dto';
import { ProgressCheckpointService } from './progress-checkpoint.service';
import { CoinLedgerRepository } from '../economy/coin-ledger.repository';

interface SessionRecord {
  id: string;
  principalType: string;
  principalId: string;
}

interface SyncStateRecord {
  revision: string;
  terminalCompletedAt: Date | null;
}

interface ExistingOperationRecord {
  opId: string;
}

interface WatermarkRecord {
  appliedThroughSeq: string;
}

interface CellStateRecord {
  state: CellStateValue;
  revision: string;
}

interface PulledOperationRecord {
  opId: string;
  deviceId: string;
  deviceSeq: string;
  cellIndex: number;
  desiredState: CellStateValue;
  resolvedState: CellStateValue;
  baseRevision: string;
  serverRevision: string;
  effective: boolean;
}

interface PatternProgressRecord {
  width: number;
  height: number;
  visibility: string;
  patternId: string;
  completedCount: string;
}

export interface ProgressAcknowledgement {
  opId: string;
  status: 'duplicate' | 'superseded' | 'applied';
}

export interface PulledProgressOperation {
  opId: string;
  deviceId: string;
  deviceSeq: number;
  cellIndex: number;
  desiredState: CellStateValue;
  resolvedState: CellStateValue;
  baseRevision: number;
  serverRevision: number;
  effective: boolean;
}

export interface ProgressSyncResult {
  revision: number;
  terminalCompleted: boolean;
  acknowledgements: ProgressAcknowledgement[];
  operations: PulledProgressOperation[];
}

export interface FirstCompletionRewardSummary {
  amount: number;
  balance: number;
}

export interface ProgressCompleteResult {
  revision: number;
  terminalCompleted: true;
  /**
   * Present only when this call minted the First Completion Reward (ADR-0011):
   * an eligible catalog Pattern completed for the first time by this account.
   * Absent on replays, already-completed sessions, and Personal Patterns.
   */
  firstCompletionReward?: FirstCompletionRewardSummary;
}

@Injectable()
export class ProgressSyncService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly checkpointService: ProgressCheckpointService,
    private readonly coinLedger: CoinLedgerRepository,
  ) {}

  async sync(
    principal: AuthPrincipal,
    sessionId: string,
    dto: ProgressSyncDto,
  ): Promise<ProgressSyncResult> {
    return this.dataSource.transaction(async (manager) => {
      await this.requireAccountSession(manager, principal, sessionId);
      await this.lockSession(manager, sessionId);
      await this.ensureSyncState(manager, sessionId);

      const syncState = await this.getSyncState(manager, sessionId);
      let revision = Number(syncState.revision);
      const terminalCompletedAt = syncState.terminalCompletedAt;
      const acknowledgements: ProgressAcknowledgement[] = [];
      const watermark = await this.getWatermark(manager, sessionId, dto.deviceId);
      const operations = [...dto.operations].sort(
        (left, right) => left.deviceSeq - right.deviceSeq,
      );

      for (const operation of operations) {
        const existing = await this.findExistingOperation(
          manager,
          sessionId,
          operation,
          dto.deviceId,
        );
        if (existing !== null || operation.deviceSeq <= watermark) {
          acknowledgements.push({ opId: operation.opId, status: 'duplicate' });
          continue;
        }

        if (terminalCompletedAt !== null) {
          await this.insertOperation(manager, {
            sessionId,
            operation,
            deviceId: dto.deviceId,
            serverRevision: revision,
            effective: false,
            superseded: true,
            resolvedState: null,
          });
          acknowledgements.push({ opId: operation.opId, status: 'superseded' });
          continue;
        }

        revision += 1;
        const current = await this.getCellState(
          manager,
          sessionId,
          operation.cellIndex,
        );
        const decision = mergeCellOperation({
          desiredState: operation.desiredState,
          baseRevision: operation.baseRevision,
          current,
        });

        if (decision.effective) {
          await manager.query<readonly CellStateRecord[]>(
            `INSERT INTO sessions.session_cell_state (
               session_id, cell_index, state, revision
             ) VALUES ($1, $2, $3, $4)
             ON CONFLICT (session_id, cell_index) DO UPDATE
             SET state = EXCLUDED.state,
                 revision = EXCLUDED.revision`,
            [sessionId, operation.cellIndex, decision.nextState, revision],
          );
        }

        await this.insertOperation(manager, {
          sessionId,
          operation,
          deviceId: dto.deviceId,
          serverRevision: revision,
          effective: decision.effective,
          superseded: false,
          resolvedState: decision.nextState,
        });
        acknowledgements.push({ opId: operation.opId, status: 'applied' });
      }

      await manager.query<readonly SyncStateRecord[]>(
        `UPDATE sessions.session_sync_state
         SET revision = $2, updated_at = now()
         WHERE session_id = $1`,
        [sessionId, revision],
      );

      // Return every authoritative operation (this device's included) newer than
      // the caller's watermark, each carrying the merge-resolved cell state so the
      // client can converge by applying resolved states in server_revision order —
      // this also corrects the client's own optimistic op when the server resolved
      // a genuinely-concurrent conflict differently (completed-wins). Superseded
      // late operations never changed cell state, so they are excluded.
      const pulled = await manager.query<readonly PulledOperationRecord[]>(
        `SELECT op_id AS "opId",
                device_id AS "deviceId",
                device_seq AS "deviceSeq",
                cell_index AS "cellIndex",
                desired_state AS "desiredState",
                resolved_state AS "resolvedState",
                base_revision AS "baseRevision",
                server_revision AS "serverRevision",
                effective
         FROM sessions.progress_operations
         WHERE session_id = $1
           AND superseded = false
           AND server_revision > $2
         ORDER BY server_revision ASC
         LIMIT 1000`,
        [sessionId, dto.sinceRevision],
      );

      return {
        revision,
        terminalCompleted: terminalCompletedAt !== null,
        acknowledgements,
        operations: pulled.map((operation) => ({
          opId: operation.opId,
          deviceId: operation.deviceId,
          deviceSeq: Number(operation.deviceSeq),
          cellIndex: operation.cellIndex,
          desiredState: operation.desiredState,
          resolvedState: operation.resolvedState,
          baseRevision: Number(operation.baseRevision),
          serverRevision: Number(operation.serverRevision),
          effective: operation.effective,
        })),
      };
    });
  }

  async complete(
    principal: AuthPrincipal,
    sessionId: string,
    dto: CompleteProgressDto,
  ): Promise<ProgressCompleteResult> {
    void dto;
    return this.dataSource.transaction(async (manager) => {
      await this.requireAccountSession(manager, principal, sessionId);
      await this.lockSession(manager, sessionId);
      await this.ensureSyncState(manager, sessionId);

      const syncState = await this.getSyncState(manager, sessionId);
      if (syncState.terminalCompletedAt !== null) {
        return { revision: Number(syncState.revision), terminalCompleted: true };
      }

      const progressRows = await manager.query<readonly PatternProgressRecord[]>(
        `SELECT p.width,
                p.height,
                p.visibility,
                p.id AS "patternId",
                COUNT(c.cell_index) FILTER (WHERE c.state = 'completed') AS "completedCount"
         FROM sessions.stitching_sessions s
         INNER JOIN catalog.patterns p ON p.id = s.pattern_id
         LEFT JOIN sessions.session_cell_state c ON c.session_id = s.id
         WHERE s.id = $1
         GROUP BY p.width, p.height, p.visibility, p.id`,
        [sessionId],
      );
      const progress = progressRows[0];
      if (!progress || Number(progress.completedCount) !== progress.width * progress.height) {
        throw new ConflictException('Session is not fully stitched');
      }

      await manager.query<readonly SyncStateRecord[]>(
        `UPDATE sessions.session_sync_state
         SET terminal_completed_at = now(), updated_at = now()
         WHERE session_id = $1`,
        [sessionId],
      );
      await manager.query<readonly SessionRecord[]>(
        `UPDATE sessions.stitching_sessions
         SET status = 'completed', completed_at = COALESCE(completed_at, now())
         WHERE id = $1 AND status <> 'completed'`,
        [sessionId],
      );
      await this.checkpointService.writeCheckpoint(manager, sessionId, true);

      // First Completion Reward (ADR-0011): only eligible catalog Patterns mint
      // it; Personal Patterns never do. Idempotent per (account, pattern) via
      // the ledger source key, so a Replay Session cannot repeat it. Runs in
      // this transaction so the coin commits atomically with the completion.
      let firstCompletionReward: FirstCompletionRewardSummary | undefined;
      if (progress.visibility === 'catalog') {
        const grant = await this.coinLedger.grantFirstCompletion(
          manager,
          { type: 'account', id: principal.id },
          progress.patternId,
          progress.width * progress.height,
        );
        if (grant.granted) {
          firstCompletionReward = {
            amount: grant.amount,
            balance: grant.balance,
          };
        }
      }

      return {
        revision: Number(syncState.revision),
        terminalCompleted: true,
        firstCompletionReward,
      };
    });
  }

  private async requireAccountSession(
    manager: EntityManager,
    principal: AuthPrincipal,
    sessionId: string,
  ): Promise<SessionRecord> {
    if (principal.type !== PrincipalType.Account) {
      throw new NotFoundException('Session not found');
    }

    const sessions = await manager.query<readonly SessionRecord[]>(
      `SELECT id,
              principal_type AS "principalType",
              principal_id AS "principalId"
       FROM sessions.stitching_sessions
       WHERE id = $1
         AND principal_type = 'account'
         AND principal_id = $2
       FOR UPDATE`,
      [sessionId, principal.id],
    );
    const session = sessions[0] ?? null;
    if (!session || session.principalType !== 'account' || session.principalId !== principal.id) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  private async lockSession(manager: EntityManager, sessionId: string): Promise<void> {
    await manager.query<readonly { locked: null }[]>(
      `SELECT pg_advisory_xact_lock(
         hashtextextended($1::text, 0)
       ) AS locked`,
      [sessionId],
    );
  }

  private async ensureSyncState(manager: EntityManager, sessionId: string): Promise<void> {
    await manager.query<readonly SyncStateRecord[]>(
      `INSERT INTO sessions.session_sync_state (session_id)
       VALUES ($1)
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId],
    );
  }

  private async getSyncState(
    manager: EntityManager,
    sessionId: string,
  ): Promise<SyncStateRecord> {
    const states = await manager.query<readonly SyncStateRecord[]>(
      `SELECT revision, terminal_completed_at AS "terminalCompletedAt"
       FROM sessions.session_sync_state
       WHERE session_id = $1`,
      [sessionId],
    );
    const state = states[0];
    if (!state) {
      throw new NotFoundException('Session sync state not found');
    }
    return state;
  }

  private async getWatermark(
    manager: EntityManager,
    sessionId: string,
    deviceId: string,
  ): Promise<number> {
    const rows = await manager.query<readonly WatermarkRecord[]>(
      `SELECT applied_through_seq AS "appliedThroughSeq"
       FROM sessions.session_device_watermarks
       WHERE session_id = $1 AND device_id = $2`,
      [sessionId, deviceId],
    );
    // No watermark row means nothing has been compacted for this device yet, so
    // no device_seq is proven-applied. Return -1 (not 0) so a legitimate first
    // operation with device_seq 0 is not mistaken for a compacted replay.
    return rows[0] ? Number(rows[0].appliedThroughSeq) : -1;
  }

  private async findExistingOperation(
    manager: EntityManager,
    sessionId: string,
    operation: IncomingProgressOperationDto,
    deviceId: string,
  ): Promise<ExistingOperationRecord | null> {
    const rows = await manager.query<readonly ExistingOperationRecord[]>(
      `SELECT op_id AS "opId"
       FROM sessions.progress_operations
       WHERE session_id = $1
         AND (op_id = $2 OR (device_id = $3 AND device_seq = $4))
       LIMIT 1`,
      [sessionId, operation.opId, deviceId, operation.deviceSeq],
    );
    return rows[0] ?? null;
  }

  private async getCellState(
    manager: EntityManager,
    sessionId: string,
    cellIndex: number,
  ): Promise<{ state: CellStateValue; revision: number }> {
    const rows = await manager.query<readonly CellStateRecord[]>(
      `SELECT state, revision
       FROM sessions.session_cell_state
       WHERE session_id = $1 AND cell_index = $2`,
      [sessionId, cellIndex],
    );
    const cell = rows[0];
    if (!cell) {
      return { state: 'incomplete', revision: 0 };
    }
    return { state: cell.state, revision: Number(cell.revision) };
  }

  private async insertOperation(
    manager: EntityManager,
    input: {
      sessionId: string;
      operation: IncomingProgressOperationDto;
      deviceId: string;
      serverRevision: number;
      effective: boolean;
      superseded: boolean;
      resolvedState: CellStateValue | null;
    },
  ): Promise<void> {
    await manager.query<readonly ExistingOperationRecord[]>(
      `INSERT INTO sessions.progress_operations (
         session_id, op_id, device_id, device_seq, cell_index, desired_state,
         base_revision, server_revision, effective, superseded, resolved_state
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        input.sessionId,
        input.operation.opId,
        input.deviceId,
        input.operation.deviceSeq,
        input.operation.cellIndex,
        input.operation.desiredState,
        input.operation.baseRevision,
        input.serverRevision,
        input.effective,
        input.superseded,
        input.resolvedState,
      ],
    );
  }
}
