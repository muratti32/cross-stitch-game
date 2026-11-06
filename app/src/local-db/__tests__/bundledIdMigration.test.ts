import { createNodeSqliteFiles, nodeSqliteAvailable } from './nodeSqliteDatabase';

const mockDatabases = createNodeSqliteFiles();

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async (filename: string) => mockDatabases.open(filename)) }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: null }));

import {
  getEditorDraft,
  getLocalPatternLikes,
  getPendingPersonalPatterns,
  getSessions,
  openNamespace,
} from '../index';
import { getDatabaseFilename } from '../namespaceLogic';

const GUEST = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const HEART = 'dc47c329-35fd-4173-9ad9-5098369beb44';
const STAR = 'c2206f08-ef17-45d9-9cbb-ecd818a8dc06';
const CATALOG_PATTERN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const raw = (identity: string) => mockDatabases.raw(getDatabaseFilename(identity));

async function reopen(identity: string): Promise<void> {
  await openNamespace(OTHER);
  await openNamespace(identity);
}

function seedV11Rows(identity: string): void {
  const db = raw(identity);
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, pattern_id, source, artifact_checksum, created_at, updated_at, status)
     VALUES (?, ?, ?, 'checksum', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'active')`,
  );
  insertSession.run('bundled_session', 'starter_heart', 'bundled');
  insertSession.run('catalog_session', CATALOG_PATTERN, 'catalog');
  db.prepare("INSERT INTO pattern_likes (pattern_id, liked_at) VALUES ('starter_star', '2026-01-01T00:00:00.000Z')").run();
  db.prepare(
    `INSERT INTO editor_drafts (source_pattern_id, width, height, history_json, updated_at)
     VALUES ('starter_heart', 4, 4, '{"snapshots":[],"cursor":0}', '2026-01-01T00:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO pending_personal_patterns (pattern_id, source_pattern_id, title, width, height, palette_json, grid_base64, created_at)
     VALUES ('personal', 'starter_heart', 'Mine', 4, 4, '[]', '', '2026-01-01T00:00:00.000Z')`,
  ).run();
  db.exec('PRAGMA user_version = 11;');
}

(nodeSqliteAvailable ? describe : describe.skip)('v12 bundled id rewrite against real SQL', () => {
  beforeEach(async () => {
    mockDatabases.clear();
    await openNamespace(OTHER);
    await openNamespace(GUEST);
  });

  test('every local table that names a pattern moves to the catalog UUID', async () => {
    seedV11Rows(GUEST);

    await reopen(GUEST);

    const sessions = await getSessions();
    expect(sessions.find((session) => session.id === 'bundled_session')?.patternId).toBe(HEART);
    expect(sessions.find((session) => session.id === 'catalog_session')?.patternId).toBe(CATALOG_PATTERN);
    expect(await getLocalPatternLikes()).toEqual({ [STAR]: true });
    expect(await getEditorDraft('starter_heart')).toBeNull();
    expect(await getEditorDraft(HEART)).toMatchObject({ width: 4 });
    expect((await getPendingPersonalPatterns())[0].sourcePatternId).toBe(HEART);
  });

  test('a rewrite that already ran changes nothing when it runs again', async () => {
    seedV11Rows(GUEST);
    await reopen(GUEST);
    const firstRun = await getSessions();

    raw(GUEST).exec('PRAGMA user_version = 11;');
    await reopen(GUEST);

    expect(await getSessions()).toEqual(firstRun);
    expect(await getLocalPatternLikes()).toEqual({ [STAR]: true });
    expect(raw(GUEST).prepare('PRAGMA user_version;').get()).toEqual({ user_version: 12 });
  });

  test('a like or draft an old app made on the seeded catalog tile does not stop the rewrite', async () => {
    seedV11Rows(GUEST);
    raw(GUEST).prepare("INSERT INTO pattern_likes (pattern_id, liked_at) VALUES (?, '2026-01-02T00:00:00.000Z')").run(STAR);
    raw(GUEST)
      .prepare(
        `INSERT INTO editor_drafts (source_pattern_id, width, height, history_json, updated_at)
         VALUES (?, 8, 8, '{"snapshots":[],"cursor":0}', '2026-01-02T00:00:00.000Z')`,
      )
      .run(HEART);

    await reopen(GUEST);

    expect(await getLocalPatternLikes()).toEqual({ [STAR]: true });
    expect(await getEditorDraft('starter_heart')).toBeNull();
    expect(await getEditorDraft(HEART)).not.toBeNull();
    expect(raw(GUEST).prepare('PRAGMA user_version;').get()).toEqual({ user_version: 12 });
  });

  test('each namespace is rewritten on its own open', async () => {
    seedV11Rows(GUEST);
    await openNamespace(OTHER);
    seedV11Rows(OTHER);

    await openNamespace(GUEST);
    expect(raw(OTHER).prepare("SELECT pattern_id FROM sessions WHERE id = 'bundled_session'").get()).toEqual({
      pattern_id: 'starter_heart',
    });

    await openNamespace(OTHER);
    expect((await getSessions()).find((session) => session.id === 'bundled_session')?.patternId).toBe(HEART);
  });
});
