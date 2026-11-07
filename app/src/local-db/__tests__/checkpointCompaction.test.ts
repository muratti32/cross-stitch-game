import { createNodeSqliteFiles, nodeSqliteAvailable } from './nodeSqliteDatabase';

const mockDatabases = createNodeSqliteFiles();

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async (filename: string) => mockDatabases.open(filename)) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-crypto', () => ({}));
jest.mock('../../api/authenticatedRequest', () => ({}));
jest.mock('../../providers', () => ({ queryClient: {} }));
jest.mock('../../promotion/capture', () => ({}));
jest.mock('../../store', () => ({}));

import {
  createSession,
  getProgressOps,
  getUnackedProgressOps,
  insertProgressOpsBatch,
  markProgressOpsAcked,
  openNamespace,
  saveCheckpoint,
  type ProgressOperation,
} from '../index';
import { useIdentityStore } from '../../identity/guestIdentity';

const GUEST = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const REMOTE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HEART = 'dc47c329-35fd-4173-9ad9-5098369beb44';
const META = { title: 'Heart', previewUrl: null, thumbnailUrl: null, width: 4, height: 4 };

function op(sessionId: string, cellIndex: number): ProgressOperation {
  return {
    opId: `${sessionId}-${cellIndex}`,
    sessionId,
    deviceId: 'device',
    deviceSeq: cellIndex + 1,
    cellIndex,
    desiredState: 'completed',
    baseRevision: cellIndex,
    createdAt: '2026-02-01T10:00:00.000Z',
  };
}

const COMPLETED = new Uint8Array(16).fill(1);

async function rowWithTwoOps(remoteSessionId: string | null): Promise<string> {
  const { id } = await createSession(HEART, 'bundled', 'bundled', 'active', remoteSessionId, META);
  await insertProgressOpsBatch([op(id, 0), op(id, 1)]);
  return id;
}

(nodeSqliteAvailable ? describe : describe.skip)('device_seq after an install lost its counter write', () => {
  test('a new op numbers past every stored op', async () => {
    mockDatabases.clear();
    useIdentityStore.setState({ guestId: null, accountId: null, isAccount: false });
    await openNamespace(ACCOUNT);
    const { id } = await createSession(HEART, 'bundled', 'bundled', 'active', REMOTE, META);
    await insertProgressOpsBatch([op(id, 0), op(id, 1)]);
    const calls = (jest.requireMock('expo-sqlite').openDatabaseAsync as jest.Mock).mock.calls;
    const raw = await mockDatabases.open(calls[calls.length - 1][0] as string);
    await raw.execAsync("UPDATE device_config SET value = '0' WHERE key = 'device_seq'");

    await insertProgressOpsBatch([op(id, 2)]);

    const seqs = (await getProgressOps(id)).map((stored) => stored.deviceSeq);
    expect(new Set(seqs).size).toBe(3);
  });
});

(nodeSqliteAvailable ? describe : describe.skip)('what a checkpoint compacts', () => {
  beforeEach(async () => {
    mockDatabases.clear();
    useIdentityStore.setState({ guestId: null, accountId: null, isAccount: false });
    await openNamespace(ACCOUNT);
    await openNamespace(GUEST);
  });

  test('a Guest row with a remote id drops its covered ops, because a Guest never syncs', async () => {
    useIdentityStore.setState({ guestId: GUEST });
    const id = await rowWithTwoOps(REMOTE);

    await saveCheckpoint(id, 2, COMPLETED);

    expect(await getProgressOps(id)).toEqual([]);
  });

  test('a Guest row without a remote id drops its covered ops', async () => {
    useIdentityStore.setState({ guestId: GUEST });
    const id = await rowWithTwoOps(null);

    await saveCheckpoint(id, 2, COMPLETED);

    expect(await getProgressOps(id)).toEqual([]);
  });

  test('an account row keeps the unacked ops only the server still needs', async () => {
    useIdentityStore.setState({ accountId: ACCOUNT, isAccount: true });
    await openNamespace(ACCOUNT);
    const id = await rowWithTwoOps(REMOTE);
    await markProgressOpsAcked([`${id}-0`]);

    await saveCheckpoint(id, 2, COMPLETED);

    expect((await getProgressOps(id)).map(({ cellIndex }) => cellIndex)).toEqual([1]);
    expect((await getUnackedProgressOps(id)).map(({ cellIndex }) => cellIndex)).toEqual([1]);
  });

  test('a namespace not known to be the Guest keeps unacked ops while the store catches up', async () => {
    useIdentityStore.setState({ guestId: GUEST });
    await openNamespace(ACCOUNT);
    const id = await rowWithTwoOps(REMOTE);

    await saveCheckpoint(id, 2, COMPLETED);

    expect(await getProgressOps(id)).toHaveLength(2);
  });
});
