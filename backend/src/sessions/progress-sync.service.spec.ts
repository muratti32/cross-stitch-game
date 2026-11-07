import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';

import { PrincipalType } from '../auth/entities';
import type { AuthPrincipal } from '../auth/auth.types';
import { ProgressSyncService } from './progress-sync.service';

const guestId = '00000000-0000-4000-8000-000000000001';
const accountId = '00000000-0000-4000-8000-000000000002';
const sessionId = '00000000-0000-4000-8000-000000000003';
const patternId = '00000000-0000-4000-8000-000000000004';
const deviceId = '00000000-0000-4000-8000-000000000005';

const guest: AuthPrincipal = {
  id: guestId,
  type: PrincipalType.Guest,
  tokenVersion: 0,
};

const account: AuthPrincipal = {
  id: accountId,
  type: PrincipalType.Account,
  tokenVersion: 0,
};

interface GuestScenario {
  sessionExists: boolean;
  sessionStatus: 'active' | 'completed';
  patternStatus: 'available' | 'removed';
  visibility: 'catalog' | 'personal';
  width: number;
  height: number;
  stitchableCellCount: number | null;
  elapsedMs: number;
  hasStitchAction: boolean;
  grantGranted: boolean;
}

function guestHarness(overrides: Partial<GuestScenario> = {}) {
  const scenario: GuestScenario = {
    sessionExists: true,
    sessionStatus: 'active',
    patternStatus: 'available',
    visibility: 'catalog',
    width: 100,
    height: 40,
    stitchableCellCount: null,
    elapsedMs: 200_000,
    hasStitchAction: true,
    grantGranted: true,
    ...overrides,
  };

  const query = jest.fn(async (sql: string): Promise<readonly object[]> => {
    await Promise.resolve();
    if (sql.includes("principal_type = 'guest'") && sql.includes('FOR UPDATE')) {
      return scenario.sessionExists
        ? [{
            id: sessionId,
            principalType: 'guest',
            principalId: guestId,
            status: scenario.sessionStatus,
            createdAt: new Date('2026-09-16T10:00:00.000Z'),
          }]
        : [];
    }
    if (sql.includes('SELECT p.status')) {
      return [{ status: scenario.patternStatus, patternId }];
    }
    if (sql.includes('FLOOR(EXTRACT(EPOCH')) {
      return [{
        width: scenario.width,
        height: scenario.height,
        stitchableCellCount: scenario.stitchableCellCount,
        visibility: scenario.visibility,
        patternId,
        elapsedMs: String(scenario.elapsedMs),
      }];
    }
    if (sql.includes('FROM economy.gameplay_events')) {
      return [{ exists: scenario.hasStitchAction }];
    }
    if (sql.includes('UPDATE sessions.stitching_sessions')) {
      scenario.sessionStatus = 'completed';
      return [];
    }
    if (
      sql.includes('INSERT INTO sessions.session_sync_state')
      || sql.includes('UPDATE sessions.session_sync_state')
    ) {
      return [];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const manager = { query };
  const dataSource = {
    transaction: jest.fn(
      (callback: (value: typeof manager) => Promise<unknown>) => callback(manager),
    ),
  };
  const checkpointService = { writeCheckpoint: jest.fn() };
  const coinLedger = {
    grantFirstCompletion: jest.fn().mockResolvedValue({
      granted: scenario.grantGranted,
      amount: scenario.grantGranted ? 60 : 0,
      balance: 85,
      replayed: !scenario.grantGranted,
    }),
  };
  const promotionService = { assertNotLocked: jest.fn().mockResolvedValue(undefined) };
  const service = new ProgressSyncService(
    dataSource as never,
    checkpointService as never,
    coinLedger as never,
    promotionService as never,
  );

  return { checkpointService, coinLedger, dataSource, query, service };
}

function accountHarness({
  stitchableCellCount,
  completedCount,
}: {
  stitchableCellCount: number | null;
  completedCount: number;
}) {
  const query = jest.fn(async (sql: string, _params?: readonly unknown[]): Promise<readonly object[]> => {
    await Promise.resolve();
    if (sql.includes("principal_type = 'account'") && sql.includes('FOR UPDATE')) {
      return [{ id: sessionId, principalType: 'account', principalId: accountId }];
    }
    if (sql.includes('pg_advisory_xact_lock')) return [{ locked: null }];
    if (sql.includes('SELECT p.status')) return [{ status: 'available', patternId }];
    if (sql.includes('INSERT INTO sessions.session_sync_state')) return [];
    if (sql.includes('FROM sessions.session_sync_state state')) {
      return [{ revision: '17', terminalCompletedAt: null }];
    }
    if (sql.includes('COUNT(c.cell_index)')) {
      return [{
        width: 20,
        height: 20,
        stitchableCellCount,
        visibility: 'catalog',
        patternId,
        completedCount: String(completedCount),
      }];
    }
    if (sql.includes('UPDATE sessions.session_sync_state')) return [];
    if (sql.includes('INSERT INTO sessions.session_progress_flags')) return [];
    if (sql.includes('UPDATE sessions.stitching_sessions')) return [];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const manager = { query };
  const dataSource = {
    transaction: jest.fn(
      (callback: (value: typeof manager) => Promise<unknown>) => callback(manager),
    ),
  };
  const checkpointService = { writeCheckpoint: jest.fn().mockResolvedValue(undefined) };
  const coinLedger = {
    grantFirstCompletion: jest.fn().mockResolvedValue({
      granted: true,
      amount: 25,
      balance: 25,
      replayed: false,
    }),
  };
  const promotionService = { assertNotLocked: jest.fn().mockResolvedValue(undefined) };
  const service = new ProgressSyncService(
    dataSource as never,
    checkpointService as never,
    coinLedger as never,
    promotionService as never,
  );

  return { checkpointService, coinLedger, manager, service };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe('ProgressSyncService.complete', () => {
  it('grants a tier-correct First Completion Reward to the Guest Ledger', async () => {
    const fixture = guestHarness();

    await expect(
      fixture.service.complete(guest, sessionId, { deviceId, completedCells: 4_000 }),
    ).resolves.toEqual({
      revision: 0,
      terminalCompleted: true,
      firstCompletionReward: { amount: 60, balance: 85 },
    });
    expect(fixture.coinLedger.grantFirstCompletion).toHaveBeenCalledWith(
      expect.anything(),
      { type: 'guest', id: guestId },
      patternId,
      4_000,
    );
  });

  it('marks the Guest session sync state terminal so a promoted session stays history', async () => {
    const fixture = guestHarness();

    await fixture.service.complete(guest, sessionId, { deviceId, completedCells: 4_000 });

    const statements = fixture.query.mock.calls.map((call) => call[0]);
    expect(statements.some((sql) => sql.includes('INSERT INTO sessions.session_sync_state'))).toBe(true);
    expect(statements.some((sql) =>
      sql.includes('UPDATE sessions.session_sync_state') && sql.includes('terminal_completed_at'),
    )).toBe(true);
  });

  it('replays an already-completed Guest claim without granting again', async () => {
    const fixture = guestHarness();

    await fixture.service.complete(guest, sessionId, {
      deviceId,
      completedCells: 4_000,
    });

    await expect(
      fixture.service.complete(guest, sessionId, { deviceId, completedCells: 4_000 }),
    ).resolves.toEqual({ revision: 0, terminalCompleted: true });
    expect(fixture.coinLedger.grantFirstCompletion).toHaveBeenCalledTimes(1);
    expect(
      fixture.query.mock.calls.filter(([sql]) =>
        String(sql).includes('UPDATE sessions.stitching_sessions'),
      ),
    ).toHaveLength(1);
  });

  it('returns 404 for a foreign or unknown Guest session', async () => {
    const fixture = guestHarness({ sessionExists: false });

    await expect(
      fixture.service.complete(guest, sessionId, { deviceId, completedCells: 4_000 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.coinLedger.grantFirstCompletion).not.toHaveBeenCalled();
  });

  it('returns 410 for a removed Pattern', async () => {
    const fixture = guestHarness({ patternStatus: 'removed' });

    const error = await caught(
      fixture.service.complete(guest, sessionId, { deviceId, completedCells: 4_000 }),
    );
    expect(error).toBeInstanceOf(GoneException);
    if (error instanceof GoneException) {
      expect(error.getResponse()).toEqual({ code: 'pattern_removed', patternId });
    }
  });

  it('rejects the wrong completed cell count as implausible', async () => {
    const fixture = guestHarness();

    const error = await caught(
      fixture.service.complete(guest, sessionId, { deviceId, completedCells: 3_999 }),
    );
    expect(error).toBeInstanceOf(ConflictException);
    if (error instanceof ConflictException) {
      expect(error.getResponse()).toEqual({
        code: 'implausible_completion',
        check: 'completed_cells',
      });
    }
  });

  it('rejects a claim without ingested stitch evidence', async () => {
    const fixture = guestHarness({ hasStitchAction: false });

    const error = await caught(
      fixture.service.complete(guest, sessionId, { deviceId, completedCells: 4_000 }),
    );
    expect(error).toBeInstanceOf(ConflictException);
    if (error instanceof ConflictException) {
      expect(error.getResponse()).toEqual({
        code: 'implausible_completion',
        check: 'stitch_action',
      });
    }
  });

  it('rejects a completion faster than 50 ms per stitch', async () => {
    const fixture = guestHarness({ elapsedMs: 199_999 });

    const error = await caught(
      fixture.service.complete(guest, sessionId, { deviceId, completedCells: 4_000 }),
    );
    expect(error).toBeInstanceOf(ConflictException);
    if (error instanceof ConflictException) {
      expect(error.getResponse()).toEqual({
        code: 'implausible_completion',
        check: 'elapsed_time',
      });
    }
  });

  it('requires completedCells for a Guest claim', async () => {
    const fixture = guestHarness();

    const error = await caught(
      fixture.service.complete(guest, sessionId, { deviceId }),
    );
    expect(error).toBeInstanceOf(BadRequestException);
    if (error instanceof BadRequestException) {
      expect(error.getResponse()).toEqual({ code: 'completed_cells_required' });
    }
    expect(fixture.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('completes a Personal Pattern without granting Coin', async () => {
    const fixture = guestHarness({ visibility: 'personal' });

    await expect(
      fixture.service.complete(guest, sessionId, { deviceId, completedCells: 4_000 }),
    ).resolves.toEqual({
      revision: 0,
      terminalCompleted: true,
      firstCompletionReward: undefined,
    });
    expect(fixture.coinLedger.grantFirstCompletion).not.toHaveBeenCalled();
  });

  it('keeps the account completion path unchanged', async () => {
    const fixture = accountHarness({ stitchableCellCount: null, completedCount: 400 });

    await expect(
      fixture.service.complete(account, sessionId, { deviceId }),
    ).resolves.toEqual({
      revision: 17,
      terminalCompleted: true,
      firstCompletionReward: { amount: 25, balance: 25 },
    });
    expect(fixture.checkpointService.writeCheckpoint).toHaveBeenCalledWith(
      fixture.manager,
      sessionId,
      true,
    );
    expect(fixture.coinLedger.grantFirstCompletion).toHaveBeenCalledWith(
      fixture.manager,
      { type: 'account', id: accountId },
      patternId,
      400,
    );
    const flagWrite = fixture.manager.query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO sessions.session_progress_flags'),
    );
    expect(flagWrite?.[1]).toEqual([sessionId]);
  });

  it('completes a sparse Pattern for an account at its stitchable count', async () => {
    const fixture = accountHarness({ stitchableCellCount: 114, completedCount: 114 });

    await expect(
      fixture.service.complete(account, sessionId, { deviceId }),
    ).resolves.toMatchObject({ terminalCompleted: true });
    expect(fixture.coinLedger.grantFirstCompletion).toHaveBeenCalledWith(
      fixture.manager,
      { type: 'account', id: accountId },
      patternId,
      114,
    );
  });

  it('holds a sparse Pattern open for an account until every stitchable cell is done', async () => {
    const fixture = accountHarness({ stitchableCellCount: 114, completedCount: 113 });

    await expect(
      fixture.service.complete(account, sessionId, { deviceId }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.coinLedger.grantFirstCompletion).not.toHaveBeenCalled();
  });

  it('keeps width × height for an account row with no stitchable count', async () => {
    const fixture = accountHarness({ stitchableCellCount: null, completedCount: 114 });

    await expect(
      fixture.service.complete(account, sessionId, { deviceId }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('completes a sparse Pattern for a Guest at its stitchable count', async () => {
    const fixture = guestHarness({
      width: 20,
      height: 20,
      stitchableCellCount: 114,
      elapsedMs: 5_700,
    });

    await expect(
      fixture.service.complete(guest, sessionId, { deviceId, completedCells: 114 }),
    ).resolves.toMatchObject({ terminalCompleted: true });
    expect(fixture.coinLedger.grantFirstCompletion).toHaveBeenCalledWith(
      expect.anything(),
      { type: 'guest', id: guestId },
      patternId,
      114,
    );
  });

  it('applies the elapsed check to the stitchable count of a sparse Pattern', async () => {
    const fixture = guestHarness({
      width: 20,
      height: 20,
      stitchableCellCount: 114,
      elapsedMs: 5_699,
    });

    const error = await caught(
      fixture.service.complete(guest, sessionId, { deviceId, completedCells: 114 }),
    );
    expect(error).toBeInstanceOf(ConflictException);
    if (error instanceof ConflictException) {
      expect(error.getResponse()).toEqual({
        code: 'implausible_completion',
        check: 'elapsed_time',
      });
    }
  });

  it('keeps width × height for a Guest row with no stitchable count', async () => {
    const fixture = guestHarness({ width: 20, height: 20 });

    const error = await caught(
      fixture.service.complete(guest, sessionId, { deviceId, completedCells: 114 }),
    );
    expect(error).toBeInstanceOf(ConflictException);
    if (error instanceof ConflictException) {
      expect(error.getResponse()).toEqual({
        code: 'implausible_completion',
        check: 'completed_cells',
      });
    }
  });

  it('keeps Guest progress sync account-only', async () => {
    const fixture = guestHarness();

    await expect(
      fixture.service.sync(guest, sessionId, {
        deviceId,
        sinceRevision: 0,
        operations: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProgressSyncService.sync progress flag', () => {
  function syncHarness(
    existingOp: boolean,
    pullRows: readonly object[] = [],
    groupRows: readonly object[] = [],
  ) {
    const query = jest.fn(async (sql: string): Promise<readonly object[]> => {
      await Promise.resolve();
      if (sql.includes("principal_type = 'account'") && sql.includes('FOR UPDATE')) {
        return [{ id: sessionId, principalType: 'account', principalId: accountId }];
      }
      if (sql.includes('pg_advisory_xact_lock')) return [{ locked: null }];
      if (sql.includes('SELECT p.status')) return [{ status: 'available', patternId }];
      if (sql.includes('INSERT INTO sessions.session_sync_state')) return [];
      if (sql.includes('FROM sessions.session_sync_state state')) {
        return [{ revision: '3', terminalCompletedAt: null }];
      }
      if (sql.includes('FROM sessions.session_device_watermarks')) return [];
      if (/SELECT op_id AS "opId"\s+FROM sessions\.progress_operations/.test(sql)) {
        return existingOp ? [{ opId: 'x' }] : [];
      }
      if (sql.includes('FROM sessions.session_cell_state')) return [];
      if (sql.includes('INSERT INTO sessions.session_cell_state')) return [];
      if (sql.includes('INSERT INTO sessions.progress_operations')) return [];
      if (sql.includes('INSERT INTO sessions.session_progress_flags')) return [];
      if (sql.includes('UPDATE sessions.session_sync_state')) return [];
      if (sql.includes('server_revision > $2')) return pullRows;
      if (sql.includes('server_revision = $2')) return groupRows;
      throw new Error(`Unexpected query: ${sql}`);
    });
    const manager = { query };
    const dataSource = {
      transaction: jest.fn(
        (callback: (value: typeof manager) => Promise<unknown>) => callback(manager),
      ),
    };
    const promotionService = { assertNotLocked: jest.fn().mockResolvedValue(undefined) };
    const service = new ProgressSyncService(
      dataSource as never,
      {} as never,
      {} as never,
      promotionService as never,
    );
    return { query, service };
  }

  const operation = {
    opId: '00000000-0000-4000-8000-0000000000a1',
    deviceSeq: 0,
    cellIndex: 4,
    desiredState: 'completed' as const,
    baseRevision: 0,
  };
  const flagWrites = (query: jest.Mock<Promise<readonly object[]>, [string, unknown[]?]>) =>
    query.mock.calls.filter(([sql]) => sql.includes('session_progress_flags'));

  it('sets has_any_progress when an accepted operation writes a cell', async () => {
    const { query, service } = syncHarness(false);
    await service.sync(account, sessionId, {
      deviceId,
      sinceRevision: 0,
      operations: [operation],
    });
    expect(flagWrites(query)).toHaveLength(1);
    expect(flagWrites(query)[0][1]).toEqual([sessionId]);
  });

  it('leaves has_any_progress alone for an empty or duplicate-only sync', async () => {
    const empty = syncHarness(false);
    await empty.service.sync(account, sessionId, {
      deviceId,
      sinceRevision: 0,
      operations: [],
    });
    expect(flagWrites(empty.query)).toHaveLength(0);

    const duplicate = syncHarness(true);
    await duplicate.service.sync(account, sessionId, {
      deviceId,
      sinceRevision: 0,
      operations: [operation],
    });
    expect(flagWrites(duplicate.query)).toHaveLength(0);
  });

  describe('pull paging', () => {
    const pulledRow = (serverRevision: number) => ({
      opId: `op-${serverRevision}`,
      deviceId,
      deviceSeq: String(serverRevision),
      cellIndex: serverRevision,
      desiredState: 'completed',
      resolvedState: 'completed',
      baseRevision: String(serverRevision - 1),
      serverRevision: String(serverRevision),
      effective: true,
    });
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) => pulledRow(index + 1));

    it('caps the returned revision at the last returned operation when the page is full', async () => {
      const { service } = syncHarness(false, rows(1001));
      const result = await service.sync(account, sessionId, {
        deviceId,
        sinceRevision: 0,
        operations: [],
      });
      expect(result.operations).toHaveLength(1000);
      expect(result.hasMore).toBe(true);
      expect(result.revision).toBe(1000);
    });

    it('returns the session head and hasMore false when the pull is complete', async () => {
      const { service } = syncHarness(false, rows(1000));
      const result = await service.sync(account, sessionId, {
        deviceId,
        sinceRevision: 0,
        operations: [],
      });
      expect(result.operations).toHaveLength(1000);
      expect(result.hasMore).toBe(false);
      const sessionHeadRevision = 3; // syncHarness stored session revision
      expect(result.revision).toBe(sessionHeadRevision);
    });

    it('ends a truncated page on a whole revision when a tie straddles the boundary', async () => {
      const tied = [
        ...rows(998),
        { ...pulledRow(999), opId: 'tie-a' },
        { ...pulledRow(999), opId: 'tie-b' },
        { ...pulledRow(999), opId: 'tie-c' },
      ];
      const { service } = syncHarness(false, tied);
      const result = await service.sync(account, sessionId, {
        deviceId,
        sinceRevision: 0,
        operations: [],
      });
      expect(result.operations).toHaveLength(998);
      expect(result.hasMore).toBe(true);
      expect(result.revision).toBe(998);
    });

    it('returns the whole revision group when one revision fills the page', async () => {
      const group = Array.from({ length: 1200 }, (_, index) => ({
        ...pulledRow(5),
        opId: `group-${index}`,
      }));
      const { service } = syncHarness(false, group.slice(0, 1001), group);
      const result = await service.sync(account, sessionId, {
        deviceId,
        sinceRevision: 4,
        operations: [],
      });
      expect(result.operations).toHaveLength(1200);
      expect(result.hasMore).toBe(true);
      expect(result.revision).toBe(5);
    });

    it('starts the sync revision above migrated Guest operations', async () => {
      const { query, service } = syncHarness(false);
      await service.sync(account, sessionId, {
        deviceId,
        sinceRevision: 0,
        operations: [],
      });
      const stateRead = query.mock.calls.find(([sql]) =>
        sql.includes('FROM sessions.session_sync_state state'),
      );
      expect(stateRead?.[0]).toMatch(
        /GREATEST\([\s\S]*MAX\(server_revision\)[\s\S]*progress_operations/,
      );
    });
  });
});

describe('ProgressSyncService.sync causal merge', () => {
  const otherDeviceId = '00000000-0000-4000-8000-000000000006';
  const cellIndex = 4;

  interface CellRow {
    state: 'completed' | 'incomplete';
    revision: number;
    cellIndex?: number;
    writerDeviceId: string | null;
    writerDeviceSeq: number | null;
  }

  interface InsertedOperation {
    deviceId: string;
    deviceSeq: number;
    cellIndex: number;
    desiredState: string;
    serverRevision: number;
    effective: boolean;
    superseded: boolean;
    resolvedState: string | null;
  }

  interface CellQueryRow extends CellRow {
    foreignOpSinceBase: boolean;
  }

  function mergeHarness(options: { revision?: number; cell?: CellRow; seeded?: InsertedOperation[] } = {}) {
    let cellRow: CellRow | null = options.cell ?? null;
    const operations: InsertedOperation[] = [...(options.seeded ?? [])];
    const cellQueries: { params: readonly unknown[]; foreignOpSinceBase: boolean }[] = [];
    let revision = options.revision ?? 7;

    const query = jest.fn(async (sql: string, params?: readonly unknown[]): Promise<readonly object[]> => {
      await Promise.resolve();
      if (sql.includes("principal_type = 'account'") && sql.includes('FOR UPDATE')) {
        return [{ id: sessionId, principalType: 'account', principalId: accountId }];
      }
      if (sql.includes('pg_advisory_xact_lock')) return [{ locked: null }];
      if (sql.includes('SELECT p.status')) return [{ status: 'available', patternId }];
      if (sql.includes('INSERT INTO sessions.session_sync_state')) return [];
      if (sql.includes('FROM sessions.session_sync_state state')) {
        return [{ revision: String(revision), terminalCompletedAt: null }];
      }
      if (sql.includes('FROM sessions.session_device_watermarks')) return [];
      if (/SELECT op_id AS "opId"\s+FROM sessions\.progress_operations/.test(sql)) {
        return [];
      }
      if (sql.includes('FROM sessions.session_cell_state')) {
        const baseRevision = params?.[2] as number;
        const requestingDeviceId = params?.[3] as string;
        const foreignOpSinceBase = operations.some(
          (operation) =>
            operation.serverRevision > baseRevision
            && !operation.superseded
            && operation.deviceId !== requestingDeviceId,
        );
        cellQueries.push({ params: params ?? [], foreignOpSinceBase });
        if (cellRow === null) return [];
        const currentCell: CellRow = cellRow;
        // Mirror the real writer lookup: exactly one effective op at the cell's
        // revision whose resolved state matches the cell, else the writer is unknown.
        const writers = operations.filter(
          (operation) =>
            operation.cellIndex === (currentCell.cellIndex ?? cellIndex)
            && operation.serverRevision === currentCell.revision
            && operation.effective
            && operation.resolvedState === currentCell.state,
        );
        const writer = writers.length === 1 ? writers[0] : null;
        const row: CellQueryRow = {
          state: currentCell.state,
          revision: currentCell.revision,
          writerDeviceId: writer?.deviceId ?? null,
          writerDeviceSeq: writer?.deviceSeq ?? null,
          foreignOpSinceBase,
        };
        return [{
          ...row,
          revision: String(row.revision),
          writerDeviceSeq: row.writerDeviceSeq === null ? null : String(row.writerDeviceSeq),
        }];
      }
      if (sql.includes('INSERT INTO sessions.session_cell_state')) {
        cellRow = {
          state: params?.[2] as 'completed' | 'incomplete',
          revision: params?.[3] as number,
          cellIndex: params?.[1] as number,
          writerDeviceId: cellRow?.writerDeviceId ?? null,
          writerDeviceSeq: cellRow?.writerDeviceSeq ?? null,
        };
        return [];
      }
      if (sql.includes('INSERT INTO sessions.progress_operations')) {
        const effective = params?.[8] as boolean;
        const deviceSeq = params?.[3] as number;
        if (effective) {
          cellRow = { ...(cellRow as CellRow), writerDeviceId: params?.[2] as string, writerDeviceSeq: deviceSeq };
        }
        operations.push({
          deviceId: params?.[2] as string,
          deviceSeq,
          cellIndex: params?.[4] as number,
          desiredState: params?.[5] as string,
          serverRevision: params?.[7] as number,
          effective,
          superseded: params?.[9] as boolean,
          resolvedState: params?.[10] as string | null,
        });
        return [];
      }
      if (sql.includes('INSERT INTO sessions.session_progress_flags')) return [];
      if (sql.includes('UPDATE sessions.session_sync_state')) {
        revision = params?.[1] as number;
        return [];
      }
      if (sql.includes('server_revision > $2')) return [];
      if (sql.includes('server_revision = $2')) return [];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const manager = { query };
    const dataSource = {
      transaction: jest.fn(
        (callback: (value: typeof manager) => Promise<unknown>) => callback(manager),
      ),
    };
    const promotionService = { assertNotLocked: jest.fn().mockResolvedValue(undefined) };
    const service = new ProgressSyncService(
      dataSource as never,
      {} as never,
      {} as never,
      promotionService as never,
    );
    return { cellQueries, operations, service, cell: () => cellRow };
  }

  const operation = (opId: string, deviceSeq: number, desiredState: 'completed' | 'incomplete') => ({
    opId,
    deviceSeq,
    cellIndex,
    desiredState,
    baseRevision: 7,
  });
  const stitchFromA = operation('00000000-0000-4000-8000-0000000000b1', 20, 'completed');
  const undoFromA = operation('00000000-0000-4000-8000-0000000000b2', 21, 'incomplete');
  const stitchFromB = operation('00000000-0000-4000-8000-0000000000b3', 7, 'completed');

  it('applies an offline undo written by the same device later in the batch', async () => {
    const { cellQueries, operations, service, cell } = mergeHarness();

    const result = await service.sync(account, sessionId, {
      deviceId,
      sinceRevision: 0,
      operations: [stitchFromA, undoFromA],
    });

    expect(cell()).toMatchObject({ state: 'incomplete', writerDeviceId: deviceId, writerDeviceSeq: 21 });
    expect(operations.map(({ resolvedState }) => resolvedState)).toEqual(['completed', 'incomplete']);
    expect(result.acknowledgements).toEqual([
      { opId: stitchFromA.opId, status: 'applied' },
      { opId: undoFromA.opId, status: 'applied' },
    ]);
    // $3 carries the op's base revision and $4 the requesting device id.
    expect(cellQueries.map(({ params }) => params.slice(2))).toEqual([
      [7, deviceId],
      [7, deviceId],
    ]);
    expect(cellQueries.map(({ foreignOpSinceBase }) => foreignOpSinceBase)).toEqual([false, false]);
  });

  it('keeps completed when another device wrote the cell concurrently', async () => {
    const { operations, service, cell } = mergeHarness();
    // Device A's offline stitch already landed at revision 8.
    await service.sync(account, sessionId, {
      deviceId,
      sinceRevision: 0,
      operations: [stitchFromA],
    });

    const result = await service.sync(account, sessionId, {
      deviceId: otherDeviceId,
      sinceRevision: 0,
      operations: [stitchFromB],
    });

    expect(cell()).toMatchObject({ state: 'completed', writerDeviceId: deviceId, writerDeviceSeq: 20 });
    expect(result.acknowledgements).toEqual([{ opId: stitchFromB.opId, status: 'applied' }]);
    expect(operations.at(-1)).toMatchObject({ deviceId: otherDeviceId, effective: false, resolvedState: 'completed' });
  });

  it('keeps a foreign concurrent stitch when the same device undoes on a later request', async () => {
    const { cellQueries, operations, service, cell } = mergeHarness();
    await service.sync(account, sessionId, {
      deviceId,
      sinceRevision: 0,
      operations: [stitchFromA],
    });
    // Device B's concurrent stitch is resolved to completed but is not effective,
    // so the cell writer is still device A.
    await service.sync(account, sessionId, {
      deviceId: otherDeviceId,
      sinceRevision: 0,
      operations: [stitchFromB],
    });

    const result = await service.sync(account, sessionId, {
      deviceId,
      sinceRevision: 0,
      operations: [undoFromA],
    });

    expect(cell()).toMatchObject({ state: 'completed', writerDeviceId: deviceId, writerDeviceSeq: 20 });
    // The undo's cell lookup sees device B's op above its base.
    expect(cellQueries.at(-1)).toMatchObject({ params: [sessionId, cellIndex, 7, deviceId], foreignOpSinceBase: true });
    expect(result.acknowledgements).toEqual([{ opId: undoFromA.opId, status: 'applied' }]);
    expect(operations.at(-1)).toMatchObject({ effective: false, resolvedState: 'completed' });
  });

  it('treats an ambiguous cell writer as unknown', async () => {
    // Promotion can shift Guest operations onto one session and leave two
    // effective ops at the cell's revision; neither may claim writer identity.
    const { operations, service, cell } = mergeHarness({
      revision: 8,
      cell: { state: 'completed', revision: 8, cellIndex, writerDeviceId: null, writerDeviceSeq: null },
      seeded: [
        { deviceId, deviceSeq: 20, cellIndex, desiredState: 'completed', serverRevision: 8, effective: true, superseded: false, resolvedState: 'completed' },
        { deviceId, deviceSeq: 19, cellIndex, desiredState: 'completed', serverRevision: 8, effective: true, superseded: false, resolvedState: 'completed' },
      ],
    });

    await service.sync(account, sessionId, {
      deviceId,
      sinceRevision: 8,
      operations: [undoFromA],
    });

    expect(cell()).toMatchObject({ state: 'completed', revision: 8 });
    expect(operations.at(-1)).toMatchObject({ effective: false, resolvedState: 'completed' });
  });

  it('keeps the old concurrent rule when the cell writer is unknown', async () => {
    // A promotion-written cell has no matching op, so its writer is unknown.
    const { operations, service, cell } = mergeHarness({
      revision: 8,
      cell: { state: 'completed', revision: 8, writerDeviceId: null, writerDeviceSeq: null },
    });

    await service.sync(account, sessionId, {
      deviceId,
      sinceRevision: 0,
      operations: [undoFromA],
    });

    expect(cell()).toMatchObject({ state: 'completed', revision: 8 });
    expect(operations.map(({ effective }) => effective)).toEqual([false]);
  });
});
