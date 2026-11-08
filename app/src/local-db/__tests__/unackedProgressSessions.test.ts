import { createNodeSqliteFiles, nodeSqliteAvailable } from './nodeSqliteDatabase';

const mockDatabases = createNodeSqliteFiles();

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async (filename: string) => mockDatabases.open(filename)) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

import {
  createSession,
  insertProgressOpsBatch,
  linkBundledSession,
  listCompletedSessionsAwaitingTerminal,
  listSessionsWithUnackedProgressOps,
  saveSyncSnapshot,
  updateSessionStatus,
  markProgressOpsAcked,
  openNamespace,
  type ProgressOperation,
} from '../index';

const GUEST = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const REMOTE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REMOTE_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REMOTE_3 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const HEART = 'dc47c329-35fd-4173-9ad9-5098369beb44';

function op(sessionId: string, deviceSeq: number): ProgressOperation {
  return {
    opId: `${sessionId}-${deviceSeq}`,
    sessionId,
    deviceId: 'device',
    deviceSeq,
    cellIndex: deviceSeq,
    desiredState: 'completed',
    baseRevision: 0,
    createdAt: '2026-02-01T10:00:00.000Z',
  };
}

const linkedRow = async () => {
  const session = await createSession(HEART, 'checksum');
  await linkBundledSession(
    ACCOUNT,
    { localSessionId: session.id, remoteSessionId: REMOTE },
    { foldedThroughSeq: 0, checkpointRevision: 0, terminalCompleted: false },
  );
  return session;
};

(nodeSqliteAvailable ? describe : describe.skip)('listSessionsWithUnackedProgressOps', () => {
  beforeEach(async () => {
    mockDatabases.clear();
    await openNamespace(GUEST);
    await openNamespace(ACCOUNT);
  });

  test('lists a linked session that still holds unacked ops, once', async () => {
    const session = await linkedRow();
    await insertProgressOpsBatch([op(session.id, 1), op(session.id, 2)]);

    const listed = await listSessionsWithUnackedProgressOps();

    expect(listed.map((row) => row.id)).toEqual([session.id]);
    expect(listed[0]?.remoteSessionId).toBe(REMOTE);
  });

  test('leaves out unlinked sessions and linked sessions with nothing to upload', async () => {
    const unlinked = await createSession(HEART, 'checksum');
    await insertProgressOpsBatch([op(unlinked.id, 1)]);
    const drained = await linkedRow();
    await insertProgressOpsBatch([op(drained.id, 1)]);
    await markProgressOpsAcked([op(drained.id, 1).opId]);
    await linkedRow();

    expect(await listSessionsWithUnackedProgressOps()).toEqual([]);
  });
});

(nodeSqliteAvailable ? describe : describe.skip)('listCompletedSessionsAwaitingTerminal', () => {
  beforeEach(async () => {
    mockDatabases.clear();
    await openNamespace(GUEST);
    await openNamespace(ACCOUNT);
  });

  test('lists linked completed sessions without a terminal server snapshot', async () => {
    const neverSynced = await createSession(HEART, 'checksum', 'bundled', 'ready', REMOTE);
    await updateSessionStatus(neverSynced.id, 'completed', '2026-02-01T10:00:00.000Z');
    const notTerminal = await createSession(HEART, 'checksum', 'bundled', 'ready', REMOTE_2);
    await updateSessionStatus(notTerminal.id, 'completed', '2026-02-01T10:00:00.000Z');
    await saveSyncSnapshot(notTerminal.id, 3, new Uint8Array(8), false);

    const listed = await listCompletedSessionsAwaitingTerminal();

    expect(listed.map((row) => row.id).sort()).toEqual([neverSynced.id, notTerminal.id].sort());
  });

  test('leaves out terminal, active and unlinked sessions', async () => {
    const terminal = await createSession(HEART, 'checksum', 'bundled', 'ready', REMOTE);
    await updateSessionStatus(terminal.id, 'completed', '2026-02-01T10:00:00.000Z');
    await saveSyncSnapshot(terminal.id, 3, new Uint8Array(8), true);
    await createSession(HEART, 'checksum', 'bundled', 'active', REMOTE_3);
    const unlinked = await createSession(HEART, 'checksum');
    await updateSessionStatus(unlinked.id, 'completed', '2026-02-01T10:00:00.000Z');

    expect(await listCompletedSessionsAwaitingTerminal()).toEqual([]);
  });
});
