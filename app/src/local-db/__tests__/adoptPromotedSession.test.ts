/**
 * Runs the real schema, capture and adoption SQL against an in-memory SQLite.
 * On runtimes without `node:sqlite` these skip and
 * `promotedSessionAdoption.test.ts` still covers every decision.
 */
import type { DrainSessionResult, PackagedSession } from '../../api/promotionContract';
import { createNodeSqliteFiles, nodeSqliteAvailable } from './nodeSqliteDatabase';

const mockDatabases = createNodeSqliteFiles();

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async (filename: string) => mockDatabases.open(filename)) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_algorithm: string, data: string) =>
    (require('crypto') as typeof import('crypto')).createHash('sha256').update(data).digest('hex'),
  ),
}));

import {
  adoptPromotedSession,
  createSession,
  getLatestCheckpoint,
  getSessionCompletedCount,
  getSessions,
  getSyncSnapshot,
  getUnackedProgressOps,
  insertProgressOpsBatch,
  openNamespace,
  readSessionPackedProgress,
  saveCheckpoint,
  unpackCompletedBitmap,
  type ProgressOperation,
} from '../index';
import { base64ToUint8Array, packCompletedBitmap, uint8ArrayToBase64 } from '../helpers';
import { captureGuestRecords } from '../../promotion/manifest';

const GUEST = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const PATTERN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REMOTE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GUEST_REMOTE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const META = { title: 'Rose', previewUrl: null, thumbnailUrl: null, width: 4, height: 4 };

function op(sessionId: string, cellIndex: number, baseRevision: number, desiredState: ProgressOperation['desiredState'] = 'completed'): ProgressOperation {
  return {
    opId: `${sessionId}-${baseRevision}-${cellIndex}`,
    sessionId,
    deviceId: 'device',
    deviceSeq: baseRevision + 1,
    cellIndex,
    desiredState,
    baseRevision,
    createdAt: '2026-02-01T10:00:00.000Z',
  };
}

const bitmapOf = (...cells: number[]): string => {
  const completed = new Uint8Array(16);
  for (const cell of cells) completed[cell] = 1;
  return uint8ArrayToBase64(packCompletedBitmap(completed));
};

const drained = (overrides: Partial<DrainSessionResult> = {}): DrainSessionResult => ({
  status: 'transferred',
  accountSessionId: REMOTE,
  revision: 500,
  packedBitmapBase64: bitmapOf(0, 1, 2),
  terminalCompleted: false,
  isLocked: false,
  ...overrides,
});

async function guestPackage(prepare: () => Promise<void>): Promise<PackagedSession[]> {
  await openNamespace(GUEST);
  await prepare();
  return (await captureGuestRecords(GUEST)).sessions;
}

(nodeSqliteAvailable ? describe : describe.skip)('adoptPromotedSession against real SQL', () => {
  beforeEach(async () => {
    mockDatabases.clear();
    await openNamespace(null);
  });

  test('a bundled Guest session arrives with the same progress, past a checkpoint that compacted its ops', async () => {
    const [session] = await guestPackage(async () => {
      const created = await createSession('starter_heart', 'bundled', 'bundled', 'active', null, META);
      await insertProgressOpsBatch([op(created.id, 0, 0), op(created.id, 1, 1)]);
      const completed = new Uint8Array(16);
      completed[0] = 1;
      completed[1] = 1;
      await saveCheckpoint(created.id, 2, completed);
      await insertProgressOpsBatch([op(created.id, 5, 2)]);
    });

    await openNamespace(ACCOUNT);
    await adoptPromotedSession(session, null);

    const [row] = await getSessions();
    expect(row).toMatchObject({ id: session.localSessionId, patternId: 'starter_heart', source: 'bundled', status: 'active', remoteSessionId: null });
    expect(await getSessionCompletedCount(row.id, 4, 4)).toBe(3);
    expect((await readSessionPackedProgress(row.id)).completedCount).toBe(3);
  });

  test('capture reads the Guest namespace even when another namespace is open', async () => {
    await openNamespace(GUEST);
    const created = await createSession('starter_heart', 'bundled', 'bundled', 'active', null, META);
    await insertProgressOpsBatch([op(created.id, 0, 0)]);
    await openNamespace(ACCOUNT);

    const capture = await captureGuestRecords(GUEST);

    expect(capture.sessions.map((session) => session.localSessionId)).toEqual([created.id]);
  });

  test('a drained session is seeded at the server revision with nothing to push, and the Play tab count is right', async () => {
    const [session] = await guestPackage(async () => {
      const created = await createSession(PATTERN, 'artifact', 'catalog', 'active', REMOTE, META);
      await insertProgressOpsBatch([op(created.id, 0, 0)]);
    });

    await openNamespace(ACCOUNT);
    await adoptPromotedSession(session, drained());

    const [row] = await getSessions();
    expect(row.remoteSessionId).toBe(REMOTE);
    expect(await getSessionCompletedCount(row.id, 4, 4)).toBe(3);
    expect(await getUnackedProgressOps(row.id)).toEqual([]);
    const snapshot = await getSyncSnapshot(row.id);
    expect(snapshot?.serverRevision).toBe(500);
    expect(Array.from(unpackCompletedBitmap(snapshot?.packedBitmap ?? new Uint8Array(0), 4))).toEqual([1, 1, 1, 0]);
  });

  test('progress stitched after adoption still reaches the Play tab count', async () => {
    const [session] = await guestPackage(async () => {
      await createSession(PATTERN, 'artifact', 'catalog', 'active', REMOTE, META);
    });
    await openNamespace(ACCOUNT);
    await adoptPromotedSession(session, drained());

    const completed = unpackCompletedBitmap(base64ToUint8Array(drained().packedBitmapBase64 ?? ''), 16);
    completed[3] = 1;
    await saveCheckpoint(session.localSessionId, 1, completed);

    expect(await getSessionCompletedCount(session.localSessionId, 4, 4)).toBe(4);
    expect((await getLatestCheckpoint(session.localSessionId))?.revision).toBe(1);
  });

  test('a second adoption after a kill before the ack changes nothing and adds no row', async () => {
    const [session] = await guestPackage(async () => {
      const created = await createSession('starter_heart', 'bundled', 'bundled', 'active', null, META);
      await insertProgressOpsBatch([op(created.id, 0, 0)]);
    });

    await openNamespace(ACCOUNT);
    await adoptPromotedSession(session, null);
    await insertProgressOpsBatch([op(session.localSessionId, 7, 0)]);
    await adoptPromotedSession(session, null);

    expect(await getSessions()).toHaveLength(1);
    expect(await getSessionCompletedCount(session.localSessionId, 4, 4)).toBe(2);
  });

  test('an account row already linked to the surviving server session wins', async () => {
    const [session] = await guestPackage(async () => {
      await createSession(PATTERN, 'artifact', 'catalog', 'active', GUEST_REMOTE, META);
    });

    await openNamespace(ACCOUNT);
    const accountRow = await createSession(PATTERN, 'artifact', 'catalog', 'active', REMOTE, META);
    await adoptPromotedSession(session, drained({ status: 'merged' }));

    expect((await getSessions()).map((row) => row.id)).toEqual([accountRow.id]);
  });

  test('two active bundled sessions union into the account row and keep its newer ops', async () => {
    const [session] = await guestPackage(async () => {
      const created = await createSession('starter_heart', 'bundled', 'bundled', 'active', null, META);
      await insertProgressOpsBatch([op(created.id, 0, 0), op(created.id, 1, 1)]);
    });

    await openNamespace(ACCOUNT);
    const accountRow = await createSession('starter_heart', 'bundled', 'bundled', 'active', null, META);
    await insertProgressOpsBatch([op(accountRow.id, 1, 0), op(accountRow.id, 2, 1)]);
    await adoptPromotedSession(session, null);
    await adoptPromotedSession(session, null);

    expect((await getSessions()).map((row) => row.id)).toEqual([accountRow.id]);
    expect(await getSessionCompletedCount(accountRow.id, 4, 4)).toBe(3);
  });

  test('a server-known session with no cells still lands as a playable row', async () => {
    const [session] = await guestPackage(async () => {
      await createSession(PATTERN, 'artifact', 'catalog', 'ready', REMOTE, META);
    });

    await openNamespace(ACCOUNT);
    await adoptPromotedSession(session, drained({ revision: 0, packedBitmapBase64: '' }));

    const [row] = await getSessions();
    expect(row.status).toBe('ready');
    expect(await getSessionCompletedCount(row.id, 4, 4)).toBe(0);
    expect(await getSyncSnapshot(row.id)).toBeNull();
  });
});
