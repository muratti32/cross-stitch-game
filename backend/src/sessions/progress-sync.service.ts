import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { PrincipalType } from '../auth/entities';
import type { AuthPrincipal } from '../auth/auth.types';
import {
  mergeCellOperation,
  type CellSnapshot,
  type CellStateValue,
} from './progress-merge';
import type {
  CompleteProgressDto,
  IncomingProgressOperationDto,
  ProgressSyncDto,
  RegisterBundledSessionDto,
} from './progress-sync.dto';
import { ProgressCheckpointService } from './progress-checkpoint.service';
import { CoinLedgerRepository } from '../economy/coin-ledger.repository';
import { MIN_MS_PER_STITCH } from '../economy/economy.constants';
import { PromotionService } from '../promotion/promotion.service';
import { applyPackagedProgress } from '../promotion/drained-session';
import { BUNDLED_STARTERS } from '../catalog/bundled-starters.generated';
import { stitchableCells, type PatternCellCounts } from '../catalog/stitchable-cells';
import { markSessionHasProgress, upsertActiveSession } from './active-session';

interface SessionRecord {
  id: string;
  principalType: string;
  principalId: string;
}

interface GuestSessionRecord extends SessionRecord {
  status: string;
  createdAt: Date;
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
  writerDeviceId: string | null;
  writerDeviceSeq: string | null;
  foreignOpSinceBase: boolean;
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

interface PatternProgressRecord extends PatternCellCounts {
  visibility: string;
  patternId: string;
  completedCount: string;
}

interface GuestCompletionPatternRecord extends PatternCellCounts {
  visibility: string;
  patternId: string;
  elapsedMs: string;
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

const PULL_PAGE_SIZE = 1000;

const PULL_SELECT = `SELECT op_id AS "opId",
                device_id AS "deviceId",
                device_seq AS "deviceSeq",
                cell_index AS "cellIndex",
                desired_state AS "desiredState",
                resolved_state AS "resolvedState",
                base_revision AS "baseRevision",
                server_revision AS "serverRevision",
                effective
         FROM sessions.progress_operations`;

export interface ProgressSyncResult {
  revision: number;
  terminalCompleted: boolean;
  acknowledgements: ProgressAcknowledgement[];
  operations: PulledProgressOperation[];
  /** True when more operations remain past this page; pull again from `revision`. */
  hasMore: boolean;
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
   * an eligible catalog Pattern completed for the first time by this principal.
   * Absent on replays, already-completed sessions, and Personal Patterns.
   */
  firstCompletionReward?: FirstCompletionRewardSummary;
}

export interface RegisterBundledSessionResult {
  sessionId: string;
  terminalCompleted: boolean;
}

@Injectable()
export class ProgressSyncService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly checkpointService: ProgressCheckpointService,
    private readonly coinLedger: CoinLedgerRepository,
    private readonly promotionService: PromotionService,
  ) {}

  async sync(
    principal: AuthPrincipal,
    sessionId: string,
    dto: ProgressSyncDto,
  ): Promise<ProgressSyncResult> {
    await this.promotionService.assertNotLocked(principal.id, principal.type);
    return this.dataSource.transaction(async (manager) => {
      await this.requireAccountSession(manager, principal, sessionId);
      await this.lockSession(manager, sessionId);
      await this.assertPatternNotRemoved(manager, sessionId);
      await this.ensureSyncState(manager, sessionId);

      const syncState = await this.getSyncState(manager, sessionId);
      let revision = Number(syncState.revision);
      const terminalCompletedAt = syncState.terminalCompletedAt;
      const acknowledgements: ProgressAcknowledgement[] = [];
      let wroteProgress = false;
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
          operation.baseRevision,
          dto.deviceId,
        );
        const decision = mergeCellOperation({
          desiredState: operation.desiredState,
          baseRevision: operation.baseRevision,
          deviceId: dto.deviceId,
          deviceSeq: operation.deviceSeq,
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
          wroteProgress = true;
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

      if (wroteProgress) await markSessionHasProgress(manager, sessionId);

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
        `${PULL_SELECT}
         WHERE session_id = $1
           AND superseded = false
           AND server_revision > $2
         ORDER BY server_revision ASC
         LIMIT $3`,
        [sessionId, dto.sinceRevision, PULL_PAGE_SIZE + 1],
      );

      // One extra row proves the page was truncated. A truncated page ends on a
      // complete server_revision group and reports a watermark no higher than
      // its last operation so the client resumes from there instead of skipping
      // the rest; the stored head stays untouched.
      const hasMore = pulled.length > PULL_PAGE_SIZE;
      const page = hasMore
        ? await this.completeTruncatedPage(manager, sessionId, pulled)
        : pulled;
      const pageRevision = hasMore
        ? Number(page[page.length - 1].serverRevision)
        : revision;

      return {
        revision: pageRevision,
        hasMore,
        terminalCompleted: terminalCompletedAt !== null,
        acknowledgements,
        operations: page.map((operation) => ({
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
    await this.promotionService.assertNotLocked(principal.id, principal.type);
    if (principal.type === PrincipalType.Guest) {
      const completedCells = dto.completedCells;
      if (completedCells === undefined) {
        throw new BadRequestException({
          code: 'completed_cells_required',
        });
      }
      return this.dataSource.transaction((manager) =>
        this.completeGuestSession(
          manager,
          principal,
          sessionId,
          completedCells,
        ),
      );
    }

    return this.dataSource.transaction(async (manager) => {
      await this.requireAccountSession(manager, principal, sessionId);
      await this.lockSession(manager, sessionId);
      await this.assertPatternNotRemoved(manager, sessionId);
      await this.ensureSyncState(manager, sessionId);

      const syncState = await this.getSyncState(manager, sessionId);
      if (syncState.terminalCompletedAt !== null) {
        return { revision: Number(syncState.revision), terminalCompleted: true };
      }

      const progressRows = await manager.query<readonly PatternProgressRecord[]>(
        `SELECT p.width,
                p.height,
                p.stitchable_cell_count AS "stitchableCellCount",
                p.visibility,
                p.id AS "patternId",
                COUNT(c.cell_index) FILTER (WHERE c.state = 'completed') AS "completedCount"
         FROM sessions.stitching_sessions s
         INNER JOIN catalog.patterns p ON p.id = s.pattern_id
         LEFT JOIN sessions.session_cell_state c ON c.session_id = s.id
         WHERE s.id = $1
         GROUP BY p.width, p.height, p.stitchable_cell_count, p.visibility, p.id`,
        [sessionId],
      );
      const progress = progressRows[0];
      if (!progress || Number(progress.completedCount) !== stitchableCells(progress)) {
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
      await markSessionHasProgress(manager, sessionId);
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
          stitchableCells(progress),
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

  async registerBundledSession(
    principal: AuthPrincipal,
    dto: RegisterBundledSessionDto,
  ): Promise<RegisterBundledSessionResult> {
    await this.promotionService.assertNotLocked(principal.id, principal.type);
    const { patternId, packedBitmapBase64, localState } = dto;
    if (!BUNDLED_STARTERS.some((starter) => starter.id === patternId)) {
      throw new NotFoundException({ code: 'not_a_bundled_starter' });
    }

    return this.dataSource.transaction(async (manager) => {
      const patterns = await manager.query<readonly PatternCellCounts[]>(
        `SELECT width, height, stitchable_cell_count AS "stitchableCellCount"
         FROM catalog.patterns WHERE id = $1 FOR SHARE`,
        [patternId],
      );
      const pattern = patterns[0];
      if (!pattern) {
        throw new NotFoundException({ code: 'starter_not_seeded' });
      }

      if (principal.type === PrincipalType.Guest) {
        return this.registerGuestIdentityOnly(manager, principal, patternId);
      }

      if (!packedBitmapBase64) {
        throw new BadRequestException({ code: 'packed_bitmap_required' });
      }

      if (localState === 'completed') {
        const session = await this.findLatestSession(manager, principal, patternId);
        if (session?.status === 'completed') {
          return { sessionId: session.id, terminalCompleted: true };
        }
      }

      const sessionId = await upsertActiveSession(manager, principal, patternId);
      await applyPackagedProgress(manager, {
        sessionId,
        deviceId: sessionId,
        packaged: {
          status: localState === 'completed' ? 'completed' : 'active',
          completedAt: dto.completedAt ?? null,
          packedBitmapBase64,
        },
        gridCells: pattern.width * pattern.height,
        stitchableCells: stitchableCells(pattern),
      });
      const syncState = await this.getSyncState(manager, sessionId);
      return { sessionId, terminalCompleted: syncState.terminalCompletedAt !== null };
    });
  }

  private async registerGuestIdentityOnly(
    manager: EntityManager,
    principal: AuthPrincipal,
    patternId: string,
  ): Promise<RegisterBundledSessionResult> {
    return {
      sessionId: await upsertActiveSession(manager, principal, patternId),
      terminalCompleted: false,
    };
  }

  private async findLatestSession(
    manager: EntityManager,
    principal: AuthPrincipal,
    patternId: string,
  ): Promise<{ id: string; status: 'active' | 'completed' } | null> {
    const sessions = await manager.query<readonly { id: string; status: 'active' | 'completed' }[]>(
      `SELECT id, status
       FROM sessions.stitching_sessions
       WHERE principal_type = $1 AND principal_id = $2 AND pattern_id = $3
       ORDER BY status = 'active' DESC, completed_at DESC NULLS LAST
       LIMIT 1`,
      [principal.type, principal.id, patternId],
    );
    return sessions[0] ?? null;
  }

  private async completeGuestSession(
    manager: EntityManager,
    principal: AuthPrincipal,
    sessionId: string,
    completedCells: number,
  ): Promise<ProgressCompleteResult> {
    const sessions = await manager.query<readonly GuestSessionRecord[]>(
      `SELECT id,
              principal_type AS "principalType",
              principal_id AS "principalId",
              status,
              created_at AS "createdAt"
       FROM sessions.stitching_sessions
       WHERE id = $1
         AND principal_type = 'guest'
         AND principal_id = $2
       FOR UPDATE`,
      [sessionId, principal.id],
    );
    const session = sessions[0] ?? null;
    if (
      !session ||
      session.principalType !== 'guest' ||
      session.principalId !== principal.id
    ) {
      throw new NotFoundException('Session not found');
    }

    await this.assertPatternNotRemoved(manager, sessionId);

    const patterns = await manager.query<readonly GuestCompletionPatternRecord[]>(
      `SELECT p.width,
              p.height,
              p.stitchable_cell_count AS "stitchableCellCount",
              p.visibility,
              p.id AS "patternId",
              FLOOR(EXTRACT(EPOCH FROM (now() - s.created_at)) * 1000)::bigint AS "elapsedMs"
       FROM sessions.stitching_sessions s
       INNER JOIN catalog.patterns p ON p.id = s.pattern_id
       WHERE s.id = $1`,
      [sessionId],
    );
    const pattern = patterns[0];
    if (!pattern) {
      throw new NotFoundException('Session not found');
    }

    if (session.status === 'completed') {
      return { revision: 0, terminalCompleted: true };
    }

    const cellCount = stitchableCells(pattern);
    if (completedCells !== cellCount) {
      this.throwImplausibleCompletion('completed_cells');
    }

    const evidence = await manager.query<readonly { exists: boolean }[]>(
      `SELECT EXISTS(
         SELECT 1
         FROM economy.gameplay_events
         WHERE principal_type = 'guest'
           AND principal_id = $1
           AND session_id = $2
           AND kind = 'stitch_action'
       ) AS "exists"`,
      [principal.id, sessionId],
    );
    if (!(evidence[0]?.exists ?? false)) {
      this.throwImplausibleCompletion('stitch_action');
    }

    if (Number(pattern.elapsedMs) < cellCount * MIN_MS_PER_STITCH) {
      this.throwImplausibleCompletion('elapsed_time');
    }

    await manager.query<readonly SessionRecord[]>(
      `UPDATE sessions.stitching_sessions
       SET status = 'completed', completed_at = COALESCE(completed_at, now())
       WHERE id = $1 AND status <> 'completed'`,
      [sessionId],
    );
    // Guest Data Promotion reassigns this session to the Registered Account,
    // after which account progress sync reads its sync state. Without a
    // terminal marker a late device op would reopen completed history, so the
    // guest claim records the same terminal state the account path writes.
    await this.ensureSyncState(manager, sessionId);
    await manager.query<readonly SyncStateRecord[]>(
      `UPDATE sessions.session_sync_state
       SET terminal_completed_at = COALESCE(terminal_completed_at, now()), updated_at = now()
       WHERE session_id = $1`,
      [sessionId],
    );

    let firstCompletionReward: FirstCompletionRewardSummary | undefined;
    if (pattern.visibility === 'catalog') {
      const grant = await this.coinLedger.grantFirstCompletion(
        manager,
        { type: 'guest', id: principal.id },
        pattern.patternId,
        cellCount,
      );
      if (grant.granted) {
        firstCompletionReward = {
          amount: grant.amount,
          balance: grant.balance,
        };
      }
    }

    return {
      revision: 0,
      terminalCompleted: true,
      firstCompletionReward,
    };
  }

  private throwImplausibleCompletion(check: string): never {
    throw new ConflictException({
      code: 'implausible_completion',
      check,
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

  // Safety Removal must block both new and existing Stitching Sessions. Progress
  // sync is the recurring "next backend check" a connected client makes, so this
  // is where the deletion instruction is delivered: every call on a removed
  // Pattern rejects the same way, which is what makes it idempotent from the
  // client's perspective.
  private async assertPatternNotRemoved(
    manager: EntityManager,
    sessionId: string,
  ): Promise<void> {
    const rows = await manager.query<readonly { status: string; patternId: string }[]>(
      `SELECT p.status, p.id AS "patternId"
       FROM sessions.stitching_sessions s
       INNER JOIN catalog.patterns p ON p.id = s.pattern_id
       WHERE s.id = $1`,
      [sessionId],
    );
    const pattern = rows[0];
    if (!pattern || pattern.status !== 'removed') return;
    // ADR-0037: Safety Removal does not apply to operator-authored bundled
    // content; a removed starter row never invalidates existing sessions.
    if (BUNDLED_STARTERS.some((starter) => starter.id === pattern.patternId)) return;
    throw new GoneException({ code: 'pattern_removed', patternId: pattern.patternId });
  }

  /**
   * Cuts a truncated pull page (PULL_PAGE_SIZE + 1 rows) down to whole
   * server_revision groups: a watermark at revision R is only safe when every
   * operation at R was delivered. When one group fills the page it is fetched
   * in full so the pull always advances.
   */
  private async completeTruncatedPage(
    manager: EntityManager,
    sessionId: string,
    pulled: readonly PulledOperationRecord[],
  ): Promise<readonly PulledOperationRecord[]> {
    const lastRevision = Number(pulled[PULL_PAGE_SIZE - 1].serverRevision);
    const extraRevision = Number(pulled[PULL_PAGE_SIZE].serverRevision);
    const page = pulled.slice(0, PULL_PAGE_SIZE);
    if (extraRevision !== lastRevision) return page;

    const complete = page.filter(
      (operation) => Number(operation.serverRevision) < lastRevision,
    );
    if (complete.length > 0) return complete;

    return manager.query<readonly PulledOperationRecord[]>(
      `${PULL_SELECT}
       WHERE session_id = $1
         AND superseded = false
         AND server_revision = $2
       ORDER BY device_id ASC, device_seq ASC`,
      [sessionId, lastRevision],
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
      `SELECT GREATEST(
                state.revision,
                COALESCE((SELECT MAX(server_revision) FROM sessions.progress_operations WHERE session_id = $1), 0)
              ) AS revision,
              state.terminal_completed_at AS "terminalCompletedAt"
       FROM sessions.session_sync_state state
       WHERE state.session_id = $1`,
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
    baseRevision: number,
    deviceId: string,
  ): Promise<CellSnapshot> {
    // The cell row carries the revision of the effective op that last wrote it.
    // Promotion can shift operations onto one session and leave several ops at
    // the same revision, so the writer is only trusted when exactly one
    // effective op matches the cell's revision AND state. A foreign op above the
    // incoming base means this op did not observe another device's write, so the
    // same-device shortcut must not apply (see mergeCellOperation).
    const rows = await manager.query<readonly CellStateRecord[]>(
      `SELECT cell.state,
              cell.revision,
              CASE WHEN writer.matches = 1 THEN writer.device_id END AS "writerDeviceId",
              CASE WHEN writer.matches = 1 THEN writer.device_seq END AS "writerDeviceSeq",
              EXISTS (
                SELECT 1
                FROM sessions.progress_operations other_op
                WHERE other_op.session_id = $1
                  AND other_op.cell_index = $2
                  AND other_op.server_revision > $3
                  AND other_op.superseded = false
                  AND other_op.device_id <> $4
              ) AS "foreignOpSinceBase"
       FROM sessions.session_cell_state cell
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS matches,
                MIN(op.device_id::text) AS device_id,
                MIN(op.device_seq) AS device_seq
         FROM sessions.progress_operations op
         WHERE op.session_id = $1
           AND op.cell_index = cell.cell_index
           AND op.server_revision = cell.revision
           AND op.effective = true
           AND op.resolved_state = cell.state
       ) writer ON true
       WHERE cell.session_id = $1 AND cell.cell_index = $2`,
      [sessionId, cellIndex, baseRevision, deviceId],
    );
    const cell = rows[0];
    if (!cell) {
      return {
        state: 'incomplete',
        revision: 0,
        writerDeviceId: null,
        writerDeviceSeq: null,
        foreignOpSinceBase: false,
      };
    }
    return {
      state: cell.state,
      revision: Number(cell.revision),
      writerDeviceId: cell.writerDeviceId,
      writerDeviceSeq: cell.writerDeviceSeq === null ? null : Number(cell.writerDeviceSeq),
      foreignOpSinceBase: cell.foreignOpSinceBase,
    };
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
