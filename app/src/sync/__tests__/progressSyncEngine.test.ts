import { syncSession } from '../progressSyncEngine';
import * as localDb from '../../local-db';
import * as api from '../../api/progressSync';

jest.mock('../../local-db', () => ({
  getUnackedProgressOps: jest.fn(),
  getSyncSnapshot: jest.fn(),
  saveSyncSnapshot: jest.fn(),
  markProgressOpsAcked: jest.fn(),
}));

jest.mock('../../api/progressSync', () => ({
  syncProgress: jest.fn(),
}));

const mockedDb = localDb as jest.Mocked<typeof localDb>;
const mockedApi = api as jest.Mocked<typeof api>;

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
});
