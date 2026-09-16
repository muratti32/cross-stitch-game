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
    const query = jest.fn(async (sql: string): Promise<readonly object[]> => {
      await Promise.resolve();
      if (sql.includes("principal_type = 'account'") && sql.includes('FOR UPDATE')) {
        return [{ id: sessionId, principalType: 'account', principalId: accountId }];
      }
      if (sql.includes('pg_advisory_xact_lock')) return [{ locked: null }];
      if (sql.includes('SELECT p.status')) return [{ status: 'available', patternId }];
      if (sql.includes('INSERT INTO sessions.session_sync_state')) return [];
      if (sql.includes('SELECT revision, terminal_completed_at')) {
        return [{ revision: '17', terminalCompletedAt: null }];
      }
      if (sql.includes('COUNT(c.cell_index)')) {
        return [{
          width: 20,
          height: 20,
          visibility: 'catalog',
          patternId,
          completedCount: '400',
        }];
      }
      if (sql.includes('UPDATE sessions.session_sync_state')) return [];
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

    await expect(
      service.complete(account, sessionId, { deviceId }),
    ).resolves.toEqual({
      revision: 17,
      terminalCompleted: true,
      firstCompletionReward: { amount: 25, balance: 25 },
    });
    expect(checkpointService.writeCheckpoint).toHaveBeenCalledWith(
      manager,
      sessionId,
      true,
    );
    expect(coinLedger.grantFirstCompletion).toHaveBeenCalledWith(
      manager,
      { type: 'account', id: accountId },
      patternId,
      400,
    );
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
