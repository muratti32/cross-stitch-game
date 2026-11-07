import { createNodeSqliteFiles, nodeSqliteAvailable } from './nodeSqliteDatabase';

const mockDatabases = createNodeSqliteFiles();

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async (filename: string) => mockDatabases.open(filename)) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

import {
  createReplaySession,
  createSession,
  deleteSession,
  getProgressOps,
  getSession,
  getSessionCompletedCount,
  getUnackedProgressOps,
  insertProgressOpsBatch,
  linkBundledSession,
  listBundledRegistrationCandidates,
  openNamespace,
  readBundledRegistrationSnapshot,
  saveCheckpoint,
  updateSessionStatus,
  type ProgressOperation,
} from '../index';
import { getDatabaseFilename } from '../namespaceLogic';
import { base64ToUint8Array, unpackCompletedBitmap } from '../helpers';

const GUEST = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const REMOTE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HEART = 'dc47c329-35fd-4173-9ad9-5098369beb44';
const STAR = 'c2206f08-ef17-45d9-9cbb-ecd818a8dc06';

function op(sessionId: string, cellIndex: number, deviceSeq: number, desiredState: ProgressOperation['desiredState'] = 'completed'): ProgressOperation {
  return {
    opId: `${sessionId}-${deviceSeq}`,
    sessionId,
    deviceId: 'device',
    deviceSeq,
    cellIndex,
    desiredState,
    baseRevision: deviceSeq - 1,
    createdAt: '2026-02-01T10:00:00.000Z',
  };
}

const startRow = (patternId: string = HEART) => createSession(patternId, 'checksum');

async function completedRow(patternId: string, completedAt: string) {
  const session = await startRow(patternId);
  await updateSessionStatus(session.id, 'completed', completedAt);
  return session;
}

const completedCellsOf = (packedBitmapBase64: string): number[] =>
  Array.from(unpackCompletedBitmap(base64ToUint8Array(packedBitmapBase64), 16).entries())
    .filter(([, value]) => value === 1)
    .map(([index]) => index);

(nodeSqliteAvailable ? describe : describe.skip)('bundled registration against real SQL', () => {
  beforeEach(async () => {
    mockDatabases.clear();
    await openNamespace(ACCOUNT);
    await openNamespace(GUEST);
  });

  describe('listBundledRegistrationCandidates', () => {
    test('offers an unlinked row and leaves linked rows, replays and other sources out', async () => {
      const unlinked = await startRow(HEART);
      const linked = await startRow(STAR);
      await linkBundledSession(GUEST, { localSessionId: linked.id, remoteSessionId: REMOTE }, 0);
      const parent = await completedRow(STAR, '2026-02-01T10:00:00.000Z');
      await linkBundledSession(GUEST, { localSessionId: parent.id, remoteSessionId: REMOTE }, 0);
      await createReplaySession(parent.id);
      await createSession(HEART, 'checksum', 'catalog', 'ready', null);

      expect(await listBundledRegistrationCandidates()).toEqual([unlinked.id]);
    });

    test('puts a completed row before the unfinished one on the same pattern', async () => {
      const unfinished = await startRow(HEART);
      const completed = await completedRow(HEART, '2026-02-01T10:00:00.000Z');

      expect(await listBundledRegistrationCandidates()).toEqual([completed.id, unfinished.id]);
    });

    test('only the newest completed row of a pattern counts, even after it was linked', async () => {
      await completedRow(HEART, '2026-02-01T10:00:00.000Z');
      const newest = await completedRow(HEART, '2026-02-02T10:00:00.000Z');

      expect(await listBundledRegistrationCandidates()).toEqual([newest.id]);

      await linkBundledSession(GUEST, { localSessionId: newest.id, remoteSessionId: REMOTE }, 0);

      expect(await listBundledRegistrationCandidates()).toEqual([]);
    });

    test('a row no manifest entry names is not offered', async () => {
      await startRow('retired_starter');

      expect(await listBundledRegistrationCandidates()).toEqual([]);
    });
  });

  describe('readBundledRegistrationSnapshot', () => {
    test('folds the checkpoint and newer ops and reports the highest seq they cover', async () => {
      const { id } = await startRow();
      await insertProgressOpsBatch([op(id, 0, 1), op(id, 1, 2)]);
      const checkpoint = new Uint8Array(16);
      checkpoint[0] = 1;
      checkpoint[1] = 1;
      await saveCheckpoint(id, 2, checkpoint);
      await insertProgressOpsBatch([op(id, 5, 3), op(id, 6, 4), op(id, 6, 5, 'incomplete')]);

      const snapshot = await readBundledRegistrationSnapshot(id);

      expect(snapshot).toMatchObject({ localSessionId: id, patternId: HEART, localState: 'in_progress', completedAt: null, foldedThroughSeq: 5 });
      expect(completedCellsOf(snapshot?.packedBitmapBase64 ?? '')).toEqual([0, 1, 5]);
    });

    test('a checkpoint that compacted its ops still counts their cells', async () => {
      const { id } = await startRow();
      await insertProgressOpsBatch([op(id, 2, 1), op(id, 3, 2)]);
      const checkpoint = new Uint8Array(16);
      checkpoint[2] = 1;
      checkpoint[3] = 1;
      await saveCheckpoint(id, 2, checkpoint);

      expect(completedCellsOf((await readBundledRegistrationSnapshot(id))?.packedBitmapBase64 ?? '')).toEqual([2, 3]);
    });

    test('a completed row reports its state and completion time', async () => {
      const { id } = await completedRow(HEART, '2026-02-01T10:00:00.000Z');

      expect(await readBundledRegistrationSnapshot(id)).toMatchObject({ localState: 'completed', completedAt: '2026-02-01T10:00:00.000Z' });
    });

    test('a deleted row has no snapshot', async () => {
      const { id } = await startRow();
      await deleteSession(id);

      expect(await readBundledRegistrationSnapshot(id)).toBeNull();
    });
  });

  describe('saveCheckpoint', () => {
    const cells = (...indexes: number[]) => {
      const completed = new Uint8Array(16);
      for (const index of indexes) completed[index] = 1;
      return completed;
    };

    test('a row with no remote id compacts as before', async () => {
      const { id } = await startRow();
      await insertProgressOpsBatch([op(id, 0, 1), op(id, 1, 2)]);

      await saveCheckpoint(id, 2, cells(0, 1));

      expect(await getProgressOps(id)).toEqual([]);
    });

    test('a linked row keeps its unacked ops and drops the acked ones', async () => {
      const { id } = await startRow();
      await insertProgressOpsBatch([op(id, 0, 1), op(id, 1, 2)]);
      await linkBundledSession(GUEST, { localSessionId: id, remoteSessionId: REMOTE }, 1);

      await saveCheckpoint(id, 2, cells(0, 1));

      expect((await getProgressOps(id)).map((kept) => kept.deviceSeq)).toEqual([2]);
      expect((await getUnackedProgressOps(id)).map((kept) => kept.deviceSeq)).toEqual([2]);
    });

    test('ops kept below the checkpoint never override it in a fold', async () => {
      const { id } = await startRow();
      await linkBundledSession(GUEST, { localSessionId: id, remoteSessionId: REMOTE }, 0);
      await insertProgressOpsBatch([op(id, 0, 1), op(id, 1, 2), op(id, 2, 3)]);

      await saveCheckpoint(id, 3, cells(0));
      await insertProgressOpsBatch([op(id, 3, 4)]);

      expect(await getProgressOps(id)).toHaveLength(4);
      expect(await getSessionCompletedCount(id, 4, 4)).toBe(2);
      expect(completedCellsOf((await readBundledRegistrationSnapshot(id))?.packedBitmapBase64 ?? '')).toEqual([0, 3]);
    });
  });

  describe('linkBundledSession', () => {
    test('sets the identity and acks folded ops only, and local replay stays whole', async () => {
      const { id } = await startRow();
      await insertProgressOpsBatch([op(id, 0, 1), op(id, 1, 2), op(id, 2, 3)]);

      await expect(linkBundledSession(GUEST, { localSessionId: id, remoteSessionId: REMOTE }, 2)).resolves.toBe(true);

      expect((await getSession(id))?.remoteSessionId).toBe(REMOTE);
      expect((await getUnackedProgressOps(id)).map((pending) => pending.deviceSeq)).toEqual([3]);
      expect(await getProgressOps(id)).toHaveLength(3);
      expect(await getSessionCompletedCount(id, 4, 4)).toBe(3);
    });

    test('drops the link when the identity changed', async () => {
      const { id } = await startRow();
      await insertProgressOpsBatch([op(id, 0, 1)]);
      await openNamespace(ACCOUNT);

      await expect(linkBundledSession(GUEST, { localSessionId: id, remoteSessionId: REMOTE }, 1)).resolves.toBe(false);

      await openNamespace(GUEST);
      expect((await getSession(id))?.remoteSessionId).toBeNull();
      expect(await getUnackedProgressOps(id)).toHaveLength(1);
    });

    test('a row linked already keeps its identity and acks nothing more', async () => {
      const { id } = await startRow();
      await insertProgressOpsBatch([op(id, 0, 1)]);
      await linkBundledSession(GUEST, { localSessionId: id, remoteSessionId: REMOTE }, 0);

      await expect(
        linkBundledSession(GUEST, { localSessionId: id, remoteSessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }, 1),
      ).resolves.toBe(false);

      expect((await getSession(id))?.remoteSessionId).toBe(REMOTE);
      expect(await getUnackedProgressOps(id)).toHaveLength(1);
    });

    test('a failure partway leaves neither the link nor the acks', async () => {
      const { id } = await startRow();
      await insertProgressOpsBatch([op(id, 0, 1)]);
      const db = mockDatabases.raw(getDatabaseFilename(GUEST));
      db.exec(`CREATE TRIGGER refuse_ack BEFORE UPDATE OF acked ON progress_ops BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);

      await expect(linkBundledSession(GUEST, { localSessionId: id, remoteSessionId: REMOTE }, 1)).rejects.toThrow('disk full');

      db.exec('DROP TRIGGER refuse_ack;');
      expect((await getSession(id))?.remoteSessionId).toBeNull();
      await expect(linkBundledSession(GUEST, { localSessionId: id, remoteSessionId: REMOTE }, 1)).resolves.toBe(true);
    });

    test('a deleted row is not linked', async () => {
      const { id } = await startRow();
      await deleteSession(id);

      await expect(linkBundledSession(GUEST, { localSessionId: id, remoteSessionId: REMOTE }, 0)).resolves.toBe(false);
    });
  });
});
