import type { EntityManager } from 'typeorm';

import { applyPackagedProgress } from './drained-session';
import { packCompletedCells } from './packaged-session';

const sessionId = '00000000-0000-4000-8000-000000000003';

function harness(completedOnServer: number) {
  const query = jest.fn(async (sql: string, _params?: readonly unknown[]): Promise<readonly object[]> => {
    await Promise.resolve();
    if (sql.includes('COUNT(*) AS completed')) return [{ completed: String(completedOnServer) }];
    return [];
  });
  const statements = (fragment: string) =>
    query.mock.calls.filter(([sql]) => sql.includes(fragment));
  return { manager: { query } as unknown as EntityManager, query, statements };
}

function packaged(status: 'active' | 'completed', cells: readonly number[]) {
  return {
    status,
    completedAt: null,
    packedBitmapBase64: packCompletedCells(cells, 400).toString('base64'),
  };
}

describe('applyPackagedProgress', () => {
  it('completes a sparse session at its stitchable count', async () => {
    const { manager, statements } = harness(114);

    await applyPackagedProgress(manager, {
      sessionId,
      deviceId: sessionId,
      packaged: packaged('completed', [1, 2, 3]),
      gridCells: 400,
      stitchableCells: 114,
    });

    expect(statements('UPDATE sessions.stitching_sessions')).toHaveLength(1);
    expect(statements('terminal_completed_at')).toHaveLength(1);
  });

  it('leaves a sparse session open below its stitchable count', async () => {
    const { manager, statements } = harness(113);

    await applyPackagedProgress(manager, {
      sessionId,
      deviceId: sessionId,
      packaged: packaged('completed', [1, 2, 3]),
      gridCells: 400,
      stitchableCells: 114,
    });

    expect(statements('UPDATE sessions.stitching_sessions')).toHaveLength(0);
  });

  it('never completes a session the package reports as active', async () => {
    const { manager, statements } = harness(114);

    await applyPackagedProgress(manager, {
      sessionId,
      deviceId: sessionId,
      packaged: packaged('active', [1, 2, 3]),
      gridCells: 400,
      stitchableCells: 114,
    });

    expect(statements('UPDATE sessions.stitching_sessions')).toHaveLength(0);
  });

  it('sizes the bitmap by the grid, not the stitchable count', async () => {
    const { manager, query } = harness(0);

    await applyPackagedProgress(manager, {
      sessionId,
      deviceId: sessionId,
      packaged: packaged('active', [5, 399]),
      gridCells: 400,
      stitchableCells: 114,
    });

    const write = query.mock.calls.find(([sql]) => sql.includes('unnest($3::int[])'));
    expect(write?.[1]).toEqual([sessionId, sessionId, [5, 399]]);
  });
});
