import { createNodeSqliteFiles, nodeSqliteAvailable } from './nodeSqliteDatabase';

const mockDatabases = createNodeSqliteFiles();

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async (filename: string) => mockDatabases.open(filename)) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

import {
  createSession,
  insertProgressOpsBatch,
  linkBundledSession,
  listSessionsWithUnackedProgressOps,
  markProgressOpsAcked,
  openNamespace,
  type ProgressOperation,
} from '../index';

const GUEST = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const REMOTE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
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
