import * as SQLite from 'expo-sqlite';

export interface StitchingSession {
  id: string;
  patternId: string;
  source: 'bundled';
  artifactChecksum: string;
  createdAt: string;
  status: 'ready';
}

let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Gets the open database instance, opening it if it doesn't exist yet.
 */
async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync('stitch_wish.db');
  }
  return dbInstance;
}

/**
 * Initializes the database tables.
 */
export async function initDatabase(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      pattern_id TEXT NOT NULL,
      source TEXT NOT NULL,
      artifact_checksum TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);
}

/**
 * Creates a new stitching session in the SQLite database.
 */
export async function createSession(
  patternId: string,
  checksum: string
): Promise<StitchingSession> {
  const db = await getDatabase();
  const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const createdAt = new Date().toISOString();
  const status = 'ready';
  const source = 'bundled';

  await db.runAsync(
    `INSERT INTO sessions (id, pattern_id, source, artifact_checksum, created_at, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    patternId,
    source,
    checksum,
    createdAt,
    status
  );

  return {
    id,
    patternId,
    source,
    artifactChecksum: checksum,
    createdAt,
    status,
  };
}

/**
 * Retrieves all stitching sessions from the SQLite database.
 */
export async function getSessions(): Promise<StitchingSession[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    pattern_id: string;
    source: string;
    artifact_checksum: string;
    created_at: string;
    status: string;
  }>('SELECT * FROM sessions ORDER BY created_at DESC');

  return rows.map((row) => ({
    id: row.id,
    patternId: row.pattern_id,
    source: row.source as 'bundled',
    artifactChecksum: row.artifact_checksum,
    createdAt: row.created_at,
    status: row.status as 'ready',
  }));
}

/**
 * Retrieves a single stitching session by its ID.
 */
export async function getSession(id: string): Promise<StitchingSession | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    id: string;
    pattern_id: string;
    source: string;
    artifact_checksum: string;
    created_at: string;
    status: string;
  }>('SELECT * FROM sessions WHERE id = ?', id);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    patternId: row.pattern_id,
    source: row.source as 'bundled',
    artifactChecksum: row.artifact_checksum,
    createdAt: row.created_at,
    status: row.status as 'ready',
  };
}

/**
 * Deletes a session by its ID.
 */
export async function deleteSession(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM sessions WHERE id = ?', id);
}
