import { completeSession, syncSession } from '../progressSyncEngine';
import * as localDb from '../../local-db';
import * as api from '../../api/progressSync';
import { queryClient } from '../../providers';
import { captureProgressSyncError } from '../../observability/sentry';

jest.mock('../../local-db', () => ({
  getUnackedProgressOps: jest.fn(),
  getSyncSnapshot: jest.fn(),
  saveSyncSnapshot: jest.fn(),
  markProgressOpsAcked: jest.fn(),
}));

jest.mock('../../api/progressSync', () => ({
  ...jest.requireActual('../../api/progressSync'),
  syncProgress: jest.fn(),
  completeProgress: jest.fn(),
}));

jest.mock('../../observability/sentry', () => ({
  captureProgressSyncError: jest.fn(),
}));

const mockedDb = jest.mocked(localDb);
const mockedApi = jest.mocked(api);

describe('syncSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uploads unacked ops, folds resolved states, saves the snapshot, and drops acked ops', async () => {
    mockedDb.getSyncSnapshot.mockResolvedValue(null);
    mockedDb.getUnackedProgressOps.mockResolvedValue([
      {
        opId: 'a',
        sessionId: 's',
        deviceId: 'devA',
        deviceSeq: 1,
        cellIndex: 0,
        desiredState: 'completed',
        baseRevision: 0,
        serverBaseRevision: 0,
        createdAt: 't',
      },
    ]);
    mockedApi.syncProgress.mockResolvedValue({
      revision: 2,
      terminalCompleted: false,
      acknowledgements: [{ opId: 'a', status: 'applied' }],
      operations: [
        {
          opId: 'a',
          deviceId: 'devA',
          deviceSeq: 1,
          cellIndex: 0,
          desiredState: 'completed',
          resolvedState: 'completed',
          baseRevision: 0,
          serverRevision: 1,
          effective: true,
        },
        {
          opId: 'b',
          deviceId: 'devB',
          deviceSeq: 1,
          cellIndex: 1,
          desiredState: 'completed',
          resolvedState: 'completed',
          baseRevision: 0,
          serverRevision: 2,
          effective: true,
        },
      ],
    });

    const completed = new Uint8Array(4);
    const outcome = await syncSession('s', 'remote-1', 'devA', completed);

    expect(mockedApi.syncProgress).toHaveBeenCalledWith('remote-1', 'devA', 0, [
      {
        opId: 'a',
        deviceSeq: 1,
        cellIndex: 0,
        desiredState: 'completed',
        baseRevision: 0,
      },
    ]);
    expect(mockedDb.markProgressOpsAcked).toHaveBeenCalledWith(['a']);
    expect(mockedDb.saveSyncSnapshot).toHaveBeenCalledWith('s', 2, completed, false);
    expect(Array.from(completed)).toEqual([1, 1, 0, 0]);
    expect(outcome.serverRevision).toBe(2);
    expect(outcome.changedCells).toEqual([0, 1]);
    expect(outcome.conflictedCells).toEqual([]);
  });

  it('reports a conflict when the server overrode this device own op', async () => {
    mockedDb.getSyncSnapshot.mockResolvedValue({
      sessionId: 's',
      serverRevision: 4,
      packedBitmap: new Uint8Array([0]),
      terminal: false,
      updatedAt: 't',
    });
    mockedDb.getUnackedProgressOps.mockResolvedValue([
      {
        opId: 'c',
        sessionId: 's',
        deviceId: 'devA',
        deviceSeq: 9,
        cellIndex: 2,
        desiredState: 'incomplete',
        baseRevision: 0,
        serverBaseRevision: 0,
        createdAt: 't',
      },
    ]);
    mockedApi.syncProgress.mockResolvedValue({
      revision: 5,
      terminalCompleted: false,
      acknowledgements: [{ opId: 'c', status: 'applied' }],
      operations: [
        {
          opId: 'c',
          deviceId: 'devA',
          deviceSeq: 9,
          cellIndex: 2,
          desiredState: 'incomplete',
          resolvedState: 'completed',
          baseRevision: 0,
          serverRevision: 5,
          effective: false,
        },
      ],
    });

    const completed = new Uint8Array(3);
    const outcome = await syncSession('s', 'remote-1', 'devA', completed);

    expect(completed[2]).toBe(1);
    expect(outcome.conflictedCells).toEqual([2]);
  });

  it('keeps pulling while the server reports more and never stores a watermark past applied ops', async () => {
    mockedDb.getSyncSnapshot.mockResolvedValue(null);
    mockedDb.getUnackedProgressOps.mockResolvedValue([
      {
        opId: 'a',
        sessionId: 's',
        deviceId: 'devA',
        deviceSeq: 1,
        cellIndex: 0,
        desiredState: 'completed',
        baseRevision: 0,
        serverBaseRevision: 0,
        createdAt: 't',
      },
    ]);
    const op = (cellIndex: number, serverRevision: number) => ({
      opId: `o${serverRevision}`,
      deviceId: 'devB',
      deviceSeq: serverRevision,
      cellIndex,
      desiredState: 'completed' as const,
      resolvedState: 'completed' as const,
      baseRevision: 0,
      serverRevision,
      effective: true,
    });
    mockedApi.syncProgress
      .mockResolvedValueOnce({
        revision: 2,
        hasMore: true,
        terminalCompleted: false,
        acknowledgements: [{ opId: 'a', status: 'applied' }],
        operations: [op(0, 1), op(1, 2)],
      })
      .mockResolvedValueOnce({
        revision: 4,
        hasMore: false,
        terminalCompleted: false,
        acknowledgements: [],
        operations: [op(2, 3), op(3, 4)],
      });

    const completed = new Uint8Array(4);
    const outcome = await syncSession('s', 'remote-1', 'devA', completed);

    expect(mockedApi.syncProgress).toHaveBeenCalledTimes(2);
    expect(mockedApi.syncProgress.mock.calls[0][2]).toBe(0);
    expect(mockedApi.syncProgress.mock.calls[0][3]).toHaveLength(1);
    expect(mockedApi.syncProgress.mock.calls[1][2]).toBe(2);
    expect(mockedApi.syncProgress.mock.calls[1][3]).toEqual([]);
    expect(mockedDb.saveSyncSnapshot.mock.calls.map((call) => call[1])).toEqual([2, 4]);
    expect(Array.from(completed)).toEqual([1, 1, 1, 1]);
    expect(outcome.serverRevision).toBe(4);
    expect(outcome.changedCells).toEqual([0, 1, 2, 3]);
  });

  it('stops paging when a page makes no progress', async () => {
    mockedDb.getSyncSnapshot.mockResolvedValue(null);
    mockedDb.getUnackedProgressOps.mockResolvedValue([]);
    mockedApi.syncProgress.mockResolvedValue({
      revision: 0,
      hasMore: true,
      terminalCompleted: false,
      acknowledgements: [],
      operations: [],
    });

    await syncSession('s', 'remote-1', 'devA', new Uint8Array(1));

    expect(mockedApi.syncProgress).toHaveBeenCalledTimes(1);
    expect(captureProgressSyncError).toHaveBeenCalledWith(
      'pull-no-progress',
      expect.any(Error),
    );
  });

  describe('multi-page pull edge cases', () => {
    const op = (cellIndex: number, serverRevision: number) => ({
      opId: `o${serverRevision}`,
      deviceId: 'devB',
      deviceSeq: serverRevision,
      cellIndex,
      desiredState: 'completed' as const,
      resolvedState: 'completed' as const,
      baseRevision: 0,
      serverRevision,
      effective: true,
    });
    beforeEach(() => {
      mockedDb.getSyncSnapshot.mockResolvedValue(null);
      mockedDb.getUnackedProgressOps.mockResolvedValue([]);
    });

    it('returns earlier pages when a later page fails', async () => {
      mockedApi.syncProgress
        .mockResolvedValueOnce({
          revision: 2,
          hasMore: true,
          terminalCompleted: false,
          acknowledgements: [],
          operations: [op(0, 1), op(1, 2)],
        })
        .mockRejectedValueOnce(new Error('network'));

      const completed = new Uint8Array(4);
      const outcome = await syncSession('s', 'remote-1', 'devA', completed);

      expect(outcome.serverRevision).toBe(2);
      expect(outcome.changedCells).toEqual([0, 1]);
      expect(outcome.pullIncomplete).toBe(true);
      expect(mockedDb.saveSyncSnapshot).toHaveBeenCalledTimes(1);
      expect(captureProgressSyncError).toHaveBeenCalledWith('pull-page', expect.any(Error));
    });

    it('returns earlier pages when a later page fails with a 5xx', async () => {
      mockedApi.syncProgress
        .mockResolvedValueOnce({
          revision: 1,
          hasMore: true,
          terminalCompleted: false,
          acknowledgements: [],
          operations: [op(0, 1)],
        })
        .mockRejectedValueOnce(new api.ProgressSyncError('down', 503));

      const outcome = await syncSession('s', 'remote-1', 'devA', new Uint8Array(4));

      expect(outcome.pullIncomplete).toBe(true);
    });

    it.each([404, 410, 409])(
      'rethrows a definitive %i from a later page',
      async (status) => {
        mockedApi.syncProgress
          .mockResolvedValueOnce({
            revision: 1,
            hasMore: true,
            terminalCompleted: false,
            acknowledgements: [],
            operations: [op(0, 1)],
          })
          .mockRejectedValueOnce(new api.ProgressSyncError('gone', status, 'pattern_removed'));

        await expect(
          syncSession('s', 'remote-1', 'devA', new Uint8Array(4)),
        ).rejects.toMatchObject({ status });
        expect(mockedDb.saveSyncSnapshot).toHaveBeenCalledTimes(1);
      },
    );

    it('still throws when the first page fails', async () => {
      mockedApi.syncProgress.mockRejectedValueOnce(new Error('network'));
      await expect(
        syncSession('s', 'remote-1', 'devA', new Uint8Array(1)),
      ).rejects.toThrow('network');
    });

    it('bounds the number of pages and reports the pull as incomplete', async () => {
      let revision = 0;
      mockedApi.syncProgress.mockImplementation(async () => {
        revision += 1;
        return {
          revision,
          hasMore: true,
          terminalCompleted: false,
          acknowledgements: [],
          operations: [op(0, revision)],
        };
      });

      const outcome = await syncSession('s', 'remote-1', 'devA', new Uint8Array(1));

      expect(mockedApi.syncProgress).toHaveBeenCalledTimes(100);
      expect(outcome.pullIncomplete).toBe(true);
      expect(outcome.serverRevision).toBe(100);
    });

    it('treats a missing hasMore as a single complete page', async () => {
      mockedApi.syncProgress.mockResolvedValue({
        revision: 7,
        terminalCompleted: false,
        acknowledgements: [],
        operations: [op(0, 1)],
      });

      const outcome = await syncSession('s', 'remote-1', 'devA', new Uint8Array(1));

      expect(mockedApi.syncProgress).toHaveBeenCalledTimes(1);
      expect(outcome.serverRevision).toBe(7);
      expect(outcome.pullIncomplete).toBe(false);
    });

    it('takes terminalCompleted from the last page', async () => {
      mockedApi.syncProgress
        .mockResolvedValueOnce({
          revision: 1,
          hasMore: true,
          terminalCompleted: false,
          acknowledgements: [],
          operations: [op(0, 1)],
        })
        .mockResolvedValueOnce({
          revision: 2,
          hasMore: false,
          terminalCompleted: true,
          acknowledgements: [],
          operations: [op(1, 2)],
        });

      const outcome = await syncSession('s', 'remote-1', 'devA', new Uint8Array(2));

      expect(outcome.terminalCompleted).toBe(true);
      expect(mockedDb.saveSyncSnapshot).toHaveBeenLastCalledWith(
        's',
        2,
        expect.any(Uint8Array),
        true,
      );
    });
  });

  it('uploads a large backlog in requests the API body limit accepts, oldest first', async () => {
    const backlog = Array.from({ length: 2000 }, (_, index) => ({
      opId: `36f8a2b4-1234-4abc-8def-${String(index).padStart(12, '0')}`,
      sessionId: 's',
      deviceId: 'devA',
      deviceSeq: 100000 + index,
      cellIndex: 100000 + index,
      desiredState: 'completed' as const,
      baseRevision: 100000 + index,
      serverBaseRevision: 100000,
      createdAt: 't',
    }));
    mockedDb.getSyncSnapshot.mockResolvedValue(null);
    mockedDb.getUnackedProgressOps.mockResolvedValue(backlog);
    mockedApi.syncProgress.mockImplementation(async (_remote, _device, _since, operations) => ({
      revision: 1,
      terminalCompleted: false,
      acknowledgements: operations.map(({ opId }) => ({ opId, status: 'applied' as const })),
      operations: [],
    }));

    await syncSession('s', 'r', 'devA', new Uint8Array(4));

    const sent = mockedApi.syncProgress.mock.calls[0][3];
    const body = JSON.stringify({ deviceId: 'devA', sinceRevision: 0, operations: sent });
    expect(body.length).toBeLessThan(100 * 1024);
    expect(sent[0].deviceSeq).toBe(100000);
    expect(sent.length).toBeGreaterThan(0);
    expect(mockedDb.markProgressOpsAcked).toHaveBeenCalledWith(sent.map((operation) => operation.opId));
  });

  it('keeps the Account completion request body unchanged', async () => {
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    mockedApi.completeProgress.mockResolvedValue({
      revision: 5,
      terminalCompleted: true,
      firstCompletionReward: { amount: 25, balance: 40 },
    });

    await expect(completeSession('remote-1', 'devA')).resolves.toBe(true);
    expect(mockedApi.completeProgress).toHaveBeenCalledWith('remote-1', 'devA');
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['economy', 'balance'],
    });
    invalidateSpy.mockRestore();
  });
});
