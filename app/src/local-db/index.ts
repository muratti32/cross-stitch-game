import * as SQLite from 'expo-sqlite';

export interface StitchingSession {
  id: string;
  patternId: string;
  source: 'bundled';
  artifactChecksum: string;
  createdAt: string;
  status: 'ready' | 'active' | 'completed';
  completedAt?: string | null;
  replayOf?: string | null;
}

export interface ProgressOperation {
  opId: string;
  sessionId: string;
  deviceId: string;
  deviceSeq: number;
  cellIndex: number;
  desiredState: 'completed' | 'incomplete';
  baseRevision: number;
  createdAt: string;
}

export interface Checkpoint {
  sessionId: string;
  revision: number;
  packedBitmap: Uint8Array;
  createdAt: string;
}

let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Gets the open database instance, opening it if it doesn't exist yet.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync('stitch_wish.db');
  }
  return dbInstance;
}

import { packCompletedBitmap, unpackCompletedBitmap, generateUUID } from './helpers';
export { packCompletedBitmap, unpackCompletedBitmap, generateUUID };


/**
 * Initializes the database tables and runs migrations.
 */
export async function initDatabase(): Promise<void> {
  const db = await getDatabase();
  
  // Enable WAL mode
  await db.execAsync('PRAGMA journal_mode=WAL;');
  
  // Ensure the base sessions table exists
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

  // Ensure device_config table exists
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS device_config (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  // Check database user_version for migration
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const currentVersion = versionRow?.user_version ?? 0;

  if (currentVersion < 1) {
    await db.withTransactionAsync(async () => {
      // 1. Add new columns to sessions table
      await db.execAsync(`
        ALTER TABLE sessions ADD COLUMN completed_at TEXT;
      `);
      await db.execAsync(`
        ALTER TABLE sessions ADD COLUMN replay_of TEXT;
      `);

      // 2. Create progress_ops table
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS progress_ops (
          op_id TEXT PRIMARY KEY NOT NULL,
          session_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          device_seq INTEGER NOT NULL,
          cell_index INTEGER NOT NULL,
          desired_state TEXT NOT NULL,
          base_revision INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
      `);

      // 3. Create checkpoints table
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS checkpoints (
          session_id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          packed_bitmap BLOB NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (session_id, revision)
        );
      `);

      // 4. Update schema version
      await db.execAsync('PRAGMA user_version = 1;');
    });
  }
}

/**
 * Retrieves the device ID, generating it once if it doesn't exist yet.
 */
export async function getDeviceId(): Promise<string> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM device_config WHERE key = 'device_id'"
  );
  if (row) {
    return row.value;
  }
  const newId = generateUUID();
  await db.runAsync(
    "INSERT OR REPLACE INTO device_config (key, value) VALUES ('device_id', ?)",
    newId
  );
  return newId;
}

/**
 * Retrieves the player's handedness layout preference, default to 'right'.
 */
export async function getHandedness(): Promise<'left' | 'right'> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM device_config WHERE key = 'handedness'"
  );
  if (row && (row.value === 'left' || row.value === 'right')) {
    return row.value as 'left' | 'right';
  }
  return 'right';
}

/**
 * Saves the player's handedness layout preference.
 */
export async function setHandedness(handedness: 'left' | 'right'): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "INSERT OR REPLACE INTO device_config (key, value) VALUES ('handedness', ?)",
    handedness
  );
}

/**
 * Gets and increments the global monotonic sequence counter for this device.
 */
export async function getNextDeviceSeq(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM device_config WHERE key = 'device_seq'"
  );
  let nextSeq = 1;
  if (row) {
    nextSeq = parseInt(row.value, 10) + 1;
  }
  await db.runAsync(
    "INSERT OR REPLACE INTO device_config (key, value) VALUES ('device_seq', ?)",
    nextSeq.toString()
  );
  return nextSeq;
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
 * Creates a replay session, linked to a completed session.
 */
export async function createReplaySession(
  parentSessionId: string
): Promise<StitchingSession> {
  const db = await getDatabase();
  const parent = await getSession(parentSessionId);
  if (!parent) {
    throw new Error(`Parent session ${parentSessionId} not found`);
  }

  const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const createdAt = new Date().toISOString();
  const status = 'ready';
  const source = parent.source;
  const checksum = parent.artifactChecksum;
  const patternId = parent.patternId;

  await db.runAsync(
    `INSERT INTO sessions (id, pattern_id, source, artifact_checksum, created_at, status, replay_of)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    patternId,
    source,
    checksum,
    createdAt,
    status,
    parentSessionId
  );

  return {
    id,
    patternId,
    source,
    artifactChecksum: checksum,
    createdAt,
    status,
    replayOf: parentSessionId,
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
    completed_at?: string | null;
    replay_of?: string | null;
  }>('SELECT * FROM sessions ORDER BY created_at DESC');

  return rows.map((row) => ({
    id: row.id,
    patternId: row.pattern_id,
    source: row.source as 'bundled',
    artifactChecksum: row.artifact_checksum,
    createdAt: row.created_at,
    status: row.status as 'ready' | 'active' | 'completed',
    completedAt: row.completed_at,
    replayOf: row.replay_of,
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
    completed_at?: string | null;
    replay_of?: string | null;
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
    status: row.status as 'ready' | 'active' | 'completed',
    completedAt: row.completed_at,
    replayOf: row.replay_of,
  };
}

/**
 * Updates the status of a session, and completed_at if completed.
 */
export async function updateSessionStatus(
  id: string,
  status: 'ready' | 'active' | 'completed',
  completedAt?: string | null
): Promise<void> {
  const db = await getDatabase();
  if (status === 'completed') {
    const ts = completedAt || new Date().toISOString();
    await db.runAsync(
      'UPDATE sessions SET status = ?, completed_at = ? WHERE id = ?',
      status,
      ts,
      id
    );
  } else {
    await db.runAsync(
      'UPDATE sessions SET status = ? WHERE id = ?',
      status,
      id
    );
  }
}

/**
 * Deletes a session by its ID.
 */
export async function deleteSession(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM sessions WHERE id = ?', id);
  await db.runAsync('DELETE FROM progress_ops WHERE session_id = ?', id);
  await db.runAsync('DELETE FROM checkpoints WHERE session_id = ?', id);
}

/**
 * Inserts a batch of progress operations in a single SQLite transaction.
 */
export async function insertProgressOpsBatch(ops: ProgressOperation[]): Promise<void> {
  if (ops.length === 0) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const op of ops) {
      await db.runAsync(
        `INSERT OR IGNORE INTO progress_ops (op_id, session_id, device_id, device_seq, cell_index, desired_state, base_revision, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        op.opId,
        op.sessionId,
        op.deviceId,
        op.deviceSeq,
        op.cellIndex,
        op.desiredState,
        op.baseRevision,
        op.createdAt
      );
    }
  });
}

/**
 * Retrieves all progress operations for a session since a specific base revision.
 */
export async function getProgressOps(
  sessionId: string,
  sinceRevision: number = 0
): Promise<ProgressOperation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    op_id: string;
    session_id: string;
    device_id: string;
    device_seq: number;
    cell_index: number;
    desired_state: string;
    base_revision: number;
    created_at: string;
  }>(
    'SELECT * FROM progress_ops WHERE session_id = ? AND base_revision >= ? ORDER BY device_seq ASC',
    sessionId,
    sinceRevision
  );

  return rows.map((row) => ({
    opId: row.op_id,
    sessionId: row.session_id,
    deviceId: row.device_id,
    deviceSeq: row.device_seq,
    cellIndex: row.cell_index,
    desiredState: row.desired_state as 'completed' | 'incomplete',
    baseRevision: row.base_revision,
    createdAt: row.created_at,
  }));
}

/**
 * Saves a checkpoint for a session and deletes older progress operations.
 */
export async function saveCheckpoint(
  sessionId: string,
  revision: number,
  completed: Uint8Array
): Promise<void> {
  const db = await getDatabase();
  const packed = packCompletedBitmap(completed);
  const createdAt = new Date().toISOString();

  await db.runAsync(
    `INSERT OR REPLACE INTO checkpoints (session_id, revision, packed_bitmap, created_at)
     VALUES (?, ?, ?, ?)`,
    sessionId,
    revision,
    packed,
    createdAt
  );

  // Compact: delete progress operations older than this checkpoint
  await db.runAsync(
    `DELETE FROM progress_ops WHERE session_id = ? AND base_revision < ?`,
    sessionId,
    revision
  );
}

/**
 * Retrieves the latest checkpoint for a session.
 */
export async function getLatestCheckpoint(
  sessionId: string
): Promise<Checkpoint | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    session_id: string;
    revision: number;
    packed_bitmap: Uint8Array | ArrayBuffer | number[];
    created_at: string;
  }>(
    'SELECT * FROM checkpoints WHERE session_id = ? ORDER BY revision DESC LIMIT 1',
    sessionId
  );

  if (!row) return null;

  // Normalize packed_bitmap to Uint8Array because different sqlite configurations might return different buffers
  let packedBitmap: Uint8Array;
  if (row.packed_bitmap instanceof Uint8Array) {
    packedBitmap = row.packed_bitmap;
  } else if (row.packed_bitmap instanceof ArrayBuffer) {
    packedBitmap = new Uint8Array(row.packed_bitmap);
  } else if (Array.isArray(row.packed_bitmap)) {
    packedBitmap = new Uint8Array(row.packed_bitmap);
  } else {
    // If it's something else, try to construct it or return empty
    packedBitmap = new Uint8Array(0);
  }

  return {
    sessionId: row.session_id,
    revision: row.revision,
    packedBitmap,
    createdAt: row.created_at,
  };
}

/**
 * Retrieves the count of completed cells for a session by combining the latest checkpoint and any newer operations.
 */
export async function getSessionCompletedCount(
  sessionId: string,
  width: number,
  height: number
): Promise<number> {
  const cellsLength = width * height;
  const checkpoint = await getLatestCheckpoint(sessionId);
  let completed: Uint8Array;
  let revision = 0;
  if (checkpoint) {
    completed = unpackCompletedBitmap(checkpoint.packedBitmap, cellsLength);
    revision = checkpoint.revision;
  } else {
    completed = new Uint8Array(cellsLength);
  }

  const ops = await getProgressOps(sessionId, revision);
  for (const op of ops) {
    if (op.cellIndex >= 0 && op.cellIndex < cellsLength) {
      completed[op.cellIndex] = op.desiredState === 'completed' ? 1 : 0;
    }
  }

  let count = 0;
  for (let i = 0; i < completed.length; i++) {
    if (completed[i] === 1) {
      count++;
    }
  }
  return count;
}
