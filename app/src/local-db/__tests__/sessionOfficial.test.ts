import { createNodeSqliteFiles, nodeSqliteAvailable } from './nodeSqliteDatabase';

const mockDatabases = createNodeSqliteFiles();

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async (filename: string) => mockDatabases.open(filename)) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

import { createReplaySession, createSession, getSession, getSessions, openNamespace } from '../index';
import { getDatabaseFilename } from '../namespaceLogic';

const GUEST = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const meta = { title: 't', previewUrl: null, thumbnailUrl: null, width: 2, height: 2 };

(nodeSqliteAvailable ? describe : describe.skip)('v15 session official flag', () => {
  beforeEach(async () => {
    mockDatabases.clear();
    await openNamespace(OTHER);
    await openNamespace(GUEST);
  });

  it.each([[true], [false], [null], [undefined]])('round-trips official=%s', async (official) => {
    const created = await createSession('p', 'c', 'catalog', 'ready', null, { ...meta, official });
    const stored = await getSession(created.id);
    expect(stored?.official).toBe(official ?? null);
    expect(created.official).toBe(official ?? null);
  });

  it('createSession without pattern meta stores unknown', async () => {
    const created = await createSession('p', 'c');
    expect((await getSession(created.id))?.official).toBeNull();
  });

  it('a replay copies the parent flag', async () => {
    const parent = await createSession('p', 'c', 'catalog', 'ready', null, { ...meta, official: true });
    const replay = await createReplaySession(parent.id);
    expect(replay.official).toBe(true);
    expect((await getSession(replay.id))?.official).toBe(true);
  });

  it('a row created before v15 reads as unknown after migration', async () => {
    const db = mockDatabases.raw(getDatabaseFilename(GUEST));
    db.prepare(
      `INSERT INTO sessions (id, pattern_id, source, artifact_checksum, created_at, updated_at, status)
       VALUES ('old', 'p', 'catalog', 'c', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'active')`,
    ).run();
    db.exec('ALTER TABLE sessions DROP COLUMN official; PRAGMA user_version = 14;');
    await openNamespace(OTHER);
    await openNamespace(GUEST);

    const old = (await getSessions()).find((session) => session.id === 'old');
    expect(old?.official).toBeNull();
    expect(db.prepare('PRAGMA user_version;').get()).toEqual({ user_version: 15 });
  });
});
