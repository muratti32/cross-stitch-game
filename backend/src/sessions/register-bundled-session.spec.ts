import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { PrincipalType } from '../auth/entities';
import type { AuthPrincipal } from '../auth/auth.types';
import { BUNDLED_STARTERS } from '../catalog/bundled-starters.generated';
import { packCompletedCells } from '../promotion/packaged-session';
import { ProgressSyncService } from './progress-sync.service';

const guest: AuthPrincipal = {
  id: '00000000-0000-4000-8000-000000000001',
  type: PrincipalType.Guest,
  tokenVersion: 0,
};
const account: AuthPrincipal = {
  id: '00000000-0000-4000-8000-000000000002',
  type: PrincipalType.Account,
  tokenVersion: 0,
};
const deviceId = '00000000-0000-4000-8000-000000000005';
const starter = BUNDLED_STARTERS[0];
const patternId = starter.id;
const GRID_CELLS = starter.width * starter.height;
const STITCHABLE = starter.stitchableCellCount;

function bitmap(count: number): string {
  const cells = Array.from({ length: count }, (_, index) => index);
  return packCompletedCells(cells, GRID_CELLS).toString('base64');
}

interface SessionRow {
  id: string;
  principalId: string;
  principalType: string;
  status: 'active' | 'completed';
  completedAt: string | null;
  terminalAt: Date | null;
  cells: Set<number>;
  writers: Set<string>;
}

function harness({ seeded = true, patternRow = {} as object } = {}) {
  const sessions: SessionRow[] = [];
  let nextId = 100;

  function row(id: unknown): SessionRow {
    const session = sessions.find((candidate) => candidate.id === id);
    if (!session) throw new Error(`Unknown session ${String(id)}`);
    return session;
  }

  const query = jest.fn(async (sql: string, params: readonly unknown[] = []): Promise<readonly object[]> => {
    await Promise.resolve();
    if (sql.includes('FROM catalog.patterns WHERE id = $1 FOR SHARE')) {
      return seeded
        ? [{ width: starter.width, height: starter.height, stitchableCellCount: STITCHABLE, ...patternRow }]
        : [];
    }
    if (sql.includes('ORDER BY status = \'active\' DESC')) {
      return sessions
        .filter((s) => s.principalType === params[0] && s.principalId === params[1])
        .sort((left, right) => Number(right.status === 'active') - Number(left.status === 'active'))
        .slice(0, 1);
    }
    if (sql.includes('INSERT INTO "sessions"."stitching_sessions"')) {
      const active = sessions.find(
        (s) => s.principalType === params[0] && s.principalId === params[1] && s.status === 'active',
      );
      if (active) return [{ id: active.id }];
      const id = `00000000-0000-4000-8000-000000000${nextId}`;
      nextId += 1;
      sessions.push({
        id,
        principalType: String(params[0]),
        principalId: String(params[1]),
        status: 'active',
        completedAt: null,
        terminalAt: null,
        cells: new Set(),
        writers: new Set(),
      });
      return [{ id }];
    }
    if (sql.includes('unnest($3::int[])')) {
      const session = row(params[0]);
      session.writers.add(String(params[1]));
      for (const cell of params[2] as number[]) session.cells.add(cell);
      return [];
    }
    if (sql.includes('COUNT(*) AS completed')) {
      return [{ completed: String(row(params[0]).cells.size) }];
    }
    if (sql.includes('COUNT(c.cell_index)')) {
      return [{
        width: starter.width,
        height: starter.height,
        stitchableCellCount: STITCHABLE,
        visibility: 'catalog',
        patternId,
        completedCount: String(row(params[0]).cells.size),
      }];
    }
    if (sql.includes('UPDATE sessions.stitching_sessions')) {
      const session = row(params[0]);
      session.status = 'completed';
      session.completedAt ??= (params[1] as string | null | undefined) ?? 'now';
      return [];
    }
    if (sql.includes('UPDATE sessions.session_sync_state')) {
      const session = row(params[0]);
      session.terminalAt ??= new Date();
      return [];
    }
    if (sql.includes('FROM sessions.session_sync_state state')) {
      return [{ revision: '0', terminalCompletedAt: row(params[0]).terminalAt }];
    }
    if (sql.includes("principal_type = 'account'") && sql.includes('FOR UPDATE')) {
      const session = row(params[0]);
      return [{ id: session.id, principalType: 'account', principalId: session.principalId }];
    }
    if (sql.includes('SELECT p.status')) return [{ status: 'available', patternId }];
    if (
      sql.includes('pg_advisory_xact_lock')
      || sql.includes('session_sync_state')
      || sql.includes('session_progress_flags')
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
  const coinLedger = {
    grantFirstCompletion: jest.fn().mockResolvedValue({
      granted: true,
      amount: 25,
      balance: 25,
      replayed: false,
    }),
    isPatternUnlocked: jest.fn().mockResolvedValue(false),
  };
  const promotionService = { assertNotLocked: jest.fn().mockResolvedValue(undefined) };
  const service = new ProgressSyncService(
    dataSource as never,
    { writeCheckpoint: jest.fn().mockResolvedValue(undefined) } as never,
    coinLedger as never,
    promotionService as never,
  );
  return { coinLedger, dataSource, promotionService, query, service, sessions };
}

async function errorOf(promise: Promise<unknown>): Promise<Error & { getResponse(): unknown }> {
  try {
    await promise;
  } catch (error) {
    return error as Error & { getResponse(): unknown };
  }
  throw new Error('Expected a rejection');
}

describe('ProgressSyncService.registerBundledSession', () => {
  describe('every principal', () => {
    it('refuses a Pattern that is not a Bundled Starter Pattern', async () => {
      const { dataSource, service } = harness();

      const error = await errorOf(
        service.registerBundledSession(account, {
          patternId: '00000000-0000-4000-8000-000000000999',
          localState: 'in_progress',
          packedBitmapBase64: bitmap(1),
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.getResponse()).toEqual({ code: 'not_a_bundled_starter' });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('names an unseeded starter, unlike an old backend bare 404', async () => {
      const { service, sessions } = harness({ seeded: false });

      const error = await errorOf(
        service.registerBundledSession(guest, { patternId, localState: 'in_progress' }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.getResponse()).toEqual({ code: 'starter_not_seeded' });
      expect(sessions).toHaveLength(0);
    });

    it('waits out a promotion in flight', async () => {
      const { promotionService, service, sessions } = harness();
      promotionService.assertNotLocked.mockRejectedValue(new ConflictException('locked'));

      await expect(
        service.registerBundledSession(guest, { patternId, localState: 'in_progress' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sessions).toHaveLength(0);
    });

    it.each([
      ['a paid starter', { unlockPriceTier: 'small' }],
      ['a withdrawn starter', { status: 'withdrawn' }],
      ['a removed starter', { status: 'removed' }],
    ])('registers %s, which only the unlock and availability checks of prepare would stop', async (_label, patternRow) => {
      const { coinLedger, service } = harness({ patternRow });

      await expect(
        service.registerBundledSession(account, {
          patternId,
          localState: 'in_progress',
          packedBitmapBase64: bitmap(1),
        }),
      ).resolves.toMatchObject({ terminalCompleted: false });
      expect(coinLedger.isPatternUnlocked).not.toHaveBeenCalled();
    });
  });

  describe('Guest', () => {
    it('finds or creates the active session with no bitmap', async () => {
      const { service, sessions } = harness();

      const first = await service.registerBundledSession(guest, { patternId, localState: 'in_progress' });
      const retry = await service.registerBundledSession(guest, { patternId, localState: 'in_progress' });

      expect(first).toEqual({ sessionId: sessions[0].id, terminalCompleted: false });
      expect(retry).toEqual(first);
      expect(sessions).toHaveLength(1);
    });

    it.each(['in_progress', 'completed'] as const)(
      'writes no cells and no completion from a full bitmap declared %s',
      async (localState) => {
        const { query, service, sessions } = harness();

        await expect(
          service.registerBundledSession(guest, {
            patternId,
            localState,
            completedAt: '2026-11-01T12:00:00.000Z',
            packedBitmapBase64: bitmap(STITCHABLE),
          }),
        ).resolves.toMatchObject({ terminalCompleted: false });

        expect(sessions[0].cells.size).toBe(0);
        expect(sessions[0].status).toBe('active');
        expect(sessions[0].terminalAt).toBeNull();
        const statements = query.mock.calls.map(([sql]) => sql);
        expect(statements.some((sql) => sql.includes('session_cell_state'))).toBe(false);
        expect(statements.some((sql) => sql.includes('UPDATE sessions.stitching_sessions'))).toBe(false);
      },
    );
  });

  describe('account', () => {
    it('requires a bitmap', async () => {
      const { service, sessions } = harness();

      const error = await errorOf(
        service.registerBundledSession(account, { patternId, localState: 'in_progress' }),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({ code: 'packed_bitmap_required' });
      expect(sessions).toHaveLength(0);
    });

    it('folds in-progress cells under the session id as writer and stays open', async () => {
      const { coinLedger, service, sessions } = harness();

      const result = await service.registerBundledSession(account, {
        patternId,
        localState: 'in_progress',
        packedBitmapBase64: bitmap(10),
      });

      expect(result).toEqual({ sessionId: sessions[0].id, terminalCompleted: false });
      expect(sessions[0].cells.size).toBe(10);
      expect([...sessions[0].writers]).toEqual([sessions[0].id]);
      expect(sessions[0].status).toBe('active');
      expect(coinLedger.grantFirstCompletion).not.toHaveBeenCalled();
    });

    it('reuses the open session on a retry', async () => {
      const { service, sessions } = harness();
      const request = { patternId, localState: 'in_progress', packedBitmapBase64: bitmap(10) } as const;

      const first = await service.registerBundledSession(account, request);
      const retry = await service.registerBundledSession(account, request);

      expect(retry).toEqual(first);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].cells.size).toBe(10);
    });

    it('ends a completed registration terminal with its own time and no coin', async () => {
      const { coinLedger, service, sessions } = harness();

      await expect(
        service.registerBundledSession(account, {
          patternId,
          localState: 'completed',
          completedAt: '2026-11-01T12:00:00.000Z',
          packedBitmapBase64: bitmap(STITCHABLE),
        }),
      ).resolves.toMatchObject({ terminalCompleted: true });

      expect(sessions[0].status).toBe('completed');
      expect(sessions[0].completedAt).toBe('2026-11-01T12:00:00.000Z');
      expect(coinLedger.grantFirstCompletion).not.toHaveBeenCalled();
    });

    it('returns the same terminal session when the response was lost', async () => {
      const { coinLedger, service, sessions } = harness();
      const request = { patternId, localState: 'completed', packedBitmapBase64: bitmap(STITCHABLE) } as const;

      const first = await service.registerBundledSession(account, request);
      const retry = await service.registerBundledSession(account, request);

      expect(retry).toEqual(first);
      expect(retry.terminalCompleted).toBe(true);
      expect(sessions).toHaveLength(1);
      expect(coinLedger.grantFirstCompletion).not.toHaveBeenCalled();
    });

    it('mints nothing when complete arrives after a terminal registration', async () => {
      const { coinLedger, service } = harness();
      const { sessionId } = await service.registerBundledSession(account, {
        patternId,
        localState: 'completed',
        packedBitmapBase64: bitmap(STITCHABLE),
      });

      await expect(service.complete(account, sessionId, { deviceId })).resolves.toEqual({
        revision: 0,
        terminalCompleted: true,
      });
      expect(coinLedger.grantFirstCompletion).not.toHaveBeenCalled();
    });

    it('keeps a session open when its completed bitmap is short', async () => {
      const { service, sessions } = harness();

      await expect(
        service.registerBundledSession(account, {
          patternId,
          localState: 'completed',
          packedBitmapBase64: bitmap(STITCHABLE - 1),
        }),
      ).resolves.toMatchObject({ terminalCompleted: false });
      expect(sessions[0].status).toBe('active');
    });

    it('closes the registered session when the player finished before the link landed', async () => {
      const { coinLedger, service, sessions } = harness();
      const open = await service.registerBundledSession(account, {
        patternId,
        localState: 'in_progress',
        packedBitmapBase64: bitmap(10),
      });

      await expect(
        service.registerBundledSession(account, {
          patternId,
          localState: 'completed',
          packedBitmapBase64: bitmap(STITCHABLE),
        }),
      ).resolves.toEqual({ sessionId: open.sessionId, terminalCompleted: true });
      expect(sessions).toHaveLength(1);
      expect(coinLedger.grantFirstCompletion).not.toHaveBeenCalled();
    });

    it('opens a new session beside a completed one for a fresh in-progress attempt', async () => {
      const { service, sessions } = harness();
      const done = await service.registerBundledSession(account, {
        patternId,
        localState: 'completed',
        packedBitmapBase64: bitmap(STITCHABLE),
      });

      const fresh = await service.registerBundledSession(account, {
        patternId,
        localState: 'in_progress',
        packedBitmapBase64: bitmap(1),
      });

      expect(fresh.sessionId).not.toBe(done.sessionId);
      expect(sessions).toHaveLength(2);
    });

    it('pays by the ordinary rules when completion follows registration', async () => {
      const { coinLedger, service } = harness();
      const { sessionId } = await service.registerBundledSession(account, {
        patternId,
        localState: 'in_progress',
        packedBitmapBase64: bitmap(STITCHABLE),
      });

      await expect(service.complete(account, sessionId, { deviceId })).resolves.toMatchObject({
        firstCompletionReward: { amount: 25, balance: 25 },
      });
      expect(coinLedger.grantFirstCompletion).toHaveBeenCalledWith(
        expect.anything(),
        { type: 'account', id: account.id },
        patternId,
        STITCHABLE,
      );
    });
  });
});
