import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { getDatabaseFilename, getDatabasePath, shouldAdopt } from './namespaceLogic';

export type PatternSource = 'bundled' | 'catalog' | 'personal';

export interface StitchingSession {
  id: string;
  patternId: string;
  source: PatternSource;
  artifactChecksum: string;
  createdAt: string;
  updatedAt: string;
  status: 'preparing' | 'ready' | 'active' | 'completed';
  completedAt?: string | null;
  replayOf?: string | null;
  remoteSessionId?: string | null;
  errorNote?: string | null;
  title?: string | null;
  previewUrl?: string | null;
  patternWidth?: number | null;
  patternHeight?: number | null;
}

export interface ProgressOperation {
  opId: string;
  sessionId: string;
  deviceId: string;
  deviceSeq: number;
  cellIndex: number;
  desiredState: 'completed' | 'incomplete';
  // Local replay ordering baseline (monotonic per session, local revision space).
  baseRevision: number;
  // Last-known SERVER revision when the op was created. This is what the sync
  // push sends as baseRevision so the server can judge causality in its own
  // revision space. Defaults to 0 for offline ops created before any sync.
  serverBaseRevision?: number;
  createdAt: string;
}

export interface Checkpoint {
  sessionId: string;
  revision: number;
  packedBitmap: Uint8Array;
  createdAt: string;
}

/**
 * Server-authoritative folded progress for an account session. Replaces the
 * local checkpoint as the reload base once a session has synced at least once.
 */
export interface SyncSnapshot {
  sessionId: string;
  serverRevision: number;
  packedBitmap: Uint8Array;
  terminal: boolean;
  updatedAt: string;
}

let activeIdentity: string | null = null;
let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Returns the current active identity.
 */
export function getActiveIdentity(): string | null {
  return activeIdentity;
}

/**
 * Namespace manager: openNamespace(identity) returns the DB handle for the active identity.
 * It closes the existing handle if the identity changes.
 * 
 * Note on iOS Storage Protection:
 * iOS database files created under the Documents/Library directories are protected by
 * default with iOS hardware-based Data Protection, ensuring encryption while locked.
 */
export async function openNamespace(identity: string | null): Promise<SQLite.SQLiteDatabase> {
  // If we already have a dbInstance open and identity matches, return it
  if (dbInstance && activeIdentity === identity) {
    return dbInstance;
  }

  // Close old database instance if it exists
  if (dbInstance) {
    try {
      await dbInstance.closeAsync();
    } catch (e) {
      console.error('Failed to close old database instance:', e);
    }
    dbInstance = null;
  }

  activeIdentity = identity;

  const filename = getDatabaseFilename(identity);
  dbInstance = await SQLite.openDatabaseAsync(filename);

  // Auto-initialize the newly opened database
  await initDatabaseForDb(dbInstance);

  return dbInstance;
}

/**
 * Gets the open database instance, opening it if it doesn't exist yet.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    dbInstance = await openNamespace(activeIdentity);
  }
  return dbInstance;
}

/**
 * Adopts the offline/pre-identity database as the target guest's database.
 * Moves the database file and WAL/SHM files atomically if the pre-identity database exists.
 */
export async function adoptPreIdentityDatabase(guestId: string): Promise<void> {
  const documentDirectory = FileSystem.documentDirectory;
  if (!documentDirectory) {
    // Web / mock fallback
    await openNamespace(guestId);
    return;
  }

  const preDbName = getDatabaseFilename(null);
  const guestDbName = getDatabaseFilename(guestId);

  const preDbPath = getDatabasePath(documentDirectory, preDbName);
  const guestDbPath = getDatabasePath(documentDirectory, guestDbName);

  const preInfo = await FileSystem.getInfoAsync(preDbPath);
  const guestInfo = await FileSystem.getInfoAsync(guestDbPath);

  const hasPre = preInfo.exists;
  const hasGuest = guestInfo.exists;

  if (shouldAdopt(hasPre, hasGuest)) {
    // 1. Close current dbInstance if open
    if (dbInstance) {
      await dbInstance.closeAsync();
      dbInstance = null;
    }

    // 2. Rename the database file
    await FileSystem.moveAsync({
      from: preDbPath,
      to: guestDbPath,
    });

    // 3. Move -wal and -shm files if they exist
    const walPathFrom = `${preDbPath}-wal`;
    const walPathTo = `${guestDbPath}-wal`;
    const shmPathFrom = `${preDbPath}-shm`;
    const shmPathTo = `${guestDbPath}-shm`;

    const walInfo = await FileSystem.getInfoAsync(walPathFrom);
    if (walInfo.exists) {
      try {
        await FileSystem.moveAsync({ from: walPathFrom, to: walPathTo });
      } catch (err) {
        console.error('Failed to move wal file:', err);
      }
    }

    const shmInfo = await FileSystem.getInfoAsync(shmPathFrom);
    if (shmInfo.exists) {
      try {
        await FileSystem.moveAsync({ from: shmPathFrom, to: shmPathTo });
      } catch (err) {
        console.error('Failed to move shm file:', err);
      }
    }
  }

  // 4. Open the new namespace
  await openNamespace(guestId);
}

import { packCompletedBitmap, unpackCompletedBitmap, generateUUID } from './helpers';
export { packCompletedBitmap, unpackCompletedBitmap, generateUUID };

/**
 * Initializes the database tables and runs migrations for a specific database.
 */
export async function initDatabaseForDb(db: SQLite.SQLiteDatabase): Promise<void> {
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

  // Ensure catalog_cache table exists
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS catalog_cache (
      surface_key TEXT PRIMARY KEY NOT NULL,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
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

  if (currentVersion < 2) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        ALTER TABLE sessions ADD COLUMN remote_session_id TEXT;
      `);
      await db.execAsync(`
        ALTER TABLE sessions ADD COLUMN error_note TEXT;
      `);
      await db.execAsync(`
        ALTER TABLE sessions ADD COLUMN title TEXT;
      `);
      await db.execAsync(`
        ALTER TABLE sessions ADD COLUMN preview_url TEXT;
      `);
      await db.execAsync(`
        ALTER TABLE sessions ADD COLUMN pattern_width INTEGER;
      `);
      await db.execAsync(`
        ALTER TABLE sessions ADD COLUMN pattern_height INTEGER;
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS pending_cancels (
          remote_session_id TEXT PRIMARY KEY NOT NULL
        );
      `);
      await db.execAsync('PRAGMA user_version = 2;');
    });
  }

  if (currentVersion < 3) {
    await db.withTransactionAsync(async () => {
      // Progress Sync (account sessions): server-revision baseline stamped on
      // each op, an ack flag so synced ops are not re-uploaded, and a folded
      // server-authoritative snapshot that becomes the reload base.
      await db.execAsync(`
        ALTER TABLE progress_ops ADD COLUMN server_base_revision INTEGER NOT NULL DEFAULT 0;
      `);
      await db.execAsync(`
        ALTER TABLE progress_ops ADD COLUMN acked INTEGER NOT NULL DEFAULT 0;
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS sync_snapshots (
          session_id TEXT PRIMARY KEY NOT NULL,
          server_revision INTEGER NOT NULL,
          packed_bitmap BLOB NOT NULL,
          terminal INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
      `);
      await db.execAsync('PRAGMA user_version = 3;');
    });
  }

  if (currentVersion < 4) {
    await db.withTransactionAsync(async () => {
      // Last-activity timestamp for sorting the Stitching Table by recency
      // rather than by creation order.
      await db.execAsync(`
        ALTER TABLE sessions ADD COLUMN updated_at TEXT;
      `);
      await db.execAsync(`
        UPDATE sessions SET updated_at = created_at WHERE updated_at IS NULL;
      `);
      await db.execAsync('PRAGMA user_version = 4;');
    });
  }
}

/**
 * Initializes the database tables and runs migrations.
 */
export async function initDatabase(): Promise<void> {
  const db = await getDatabase();
  await initDatabaseForDb(db);
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
 * Checks if the player has seen the guest data risk notice.
 */
export async function hasSeenGuestDataRiskNotice(): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM device_config WHERE key = 'guest_data_risk_notice_seen'"
  );
  return row?.value === '1';
}

/**
 * Marks that the player has seen the guest data risk notice.
 */
export async function markGuestDataRiskNoticeSeen(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "INSERT OR REPLACE INTO device_config (key, value) VALUES ('guest_data_risk_notice_seen', '1')"
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
 * Reads the device's persistent monotonic sequence high-water mark. Unlike
 * MAX(device_seq) over progress_ops, this never regresses when acknowledged ops
 * are compacted away after a sync, so the server never mistakes a fresh op for a
 * replay of an already-applied sequence.
 */
export async function getDeviceSeqHigh(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM device_config WHERE key = 'device_seq'"
  );
  return row ? parseInt(row.value, 10) : 0;
}

/**
 * Persists the device's monotonic sequence high-water mark.
 */
export async function setDeviceSeqHigh(value: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "INSERT OR REPLACE INTO device_config (key, value) VALUES ('device_seq', ?)",
    value.toString()
  );
}

/**
 * Creates a new stitching session in the SQLite database.
 */
export interface SessionPatternMeta {
  title: string;
  previewUrl: string | null;
  width: number;
  height: number;
}

export async function createSession(
  patternId: string,
  checksum: string,
  source: PatternSource = 'bundled',
  status: 'preparing' | 'ready' | 'active' | 'completed' = 'ready',
  remoteSessionId: string | null = null,
  patternMeta: SessionPatternMeta | null = null
): Promise<StitchingSession> {
  const db = await getDatabase();
  const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const createdAt = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO sessions (id, pattern_id, source, artifact_checksum, created_at, updated_at, status, remote_session_id, title, preview_url, pattern_width, pattern_height)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    patternId,
    source,
    checksum,
    createdAt,
    createdAt,
    status,
    remoteSessionId,
    patternMeta?.title ?? null,
    patternMeta?.previewUrl ?? null,
    patternMeta?.width ?? null,
    patternMeta?.height ?? null
  );

  return {
    id,
    patternId,
    source,
    artifactChecksum: checksum,
    createdAt,
    updatedAt: createdAt,
    status,
    remoteSessionId,
    title: patternMeta?.title ?? null,
    previewUrl: patternMeta?.previewUrl ?? null,
    patternWidth: patternMeta?.width ?? null,
    patternHeight: patternMeta?.height ?? null,
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
    `INSERT INTO sessions (id, pattern_id, source, artifact_checksum, created_at, updated_at, status, replay_of)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    patternId,
    source,
    checksum,
    createdAt,
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
    updatedAt: createdAt,
    status,
    replayOf: parentSessionId,
  };
}

export async function findActiveSessionForPattern(
  patternId: string,
  source: PatternSource,
): Promise<StitchingSession | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM sessions WHERE pattern_id = ? AND source = ? AND status <> 'completed' ORDER BY created_at DESC",
    patternId,
    source,
  );
  if (!row) return null;
  return getSession(row.id);
}

export async function getSessions(): Promise<StitchingSession[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    pattern_id: string;
    source: string;
    artifact_checksum: string;
    created_at: string;
    updated_at: string;
    status: string;
    completed_at?: string | null;
    replay_of?: string | null;
    remote_session_id?: string | null;
    error_note?: string | null;
    title?: string | null;
    preview_url?: string | null;
    pattern_width?: number | null;
    pattern_height?: number | null;
  }>('SELECT * FROM sessions ORDER BY updated_at DESC');

  return rows.map((row) => ({
    id: row.id,
    patternId: row.pattern_id,
    source: row.source as PatternSource,
    artifactChecksum: row.artifact_checksum,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status as 'preparing' | 'ready' | 'active' | 'completed',
    completedAt: row.completed_at,
    replayOf: row.replay_of,
    remoteSessionId: row.remote_session_id,
    errorNote: row.error_note,
    title: row.title ?? null,
    previewUrl: row.preview_url ?? null,
    patternWidth: row.pattern_width ?? null,
    patternHeight: row.pattern_height ?? null,
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
    updated_at: string;
    status: string;
    completed_at?: string | null;
    replay_of?: string | null;
    remote_session_id?: string | null;
    error_note?: string | null;
    title?: string | null;
    preview_url?: string | null;
    pattern_width?: number | null;
    pattern_height?: number | null;
  }>('SELECT * FROM sessions WHERE id = ?', id);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    patternId: row.pattern_id,
    source: row.source as PatternSource,
    artifactChecksum: row.artifact_checksum,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status as 'preparing' | 'ready' | 'active' | 'completed',
    completedAt: row.completed_at,
    replayOf: row.replay_of,
    remoteSessionId: row.remote_session_id,
    errorNote: row.error_note,
    title: row.title ?? null,
    previewUrl: row.preview_url ?? null,
    patternWidth: row.pattern_width ?? null,
    patternHeight: row.pattern_height ?? null,
  };
}

/**
 * Updates the status of a session, and completed_at if completed.
 */
export async function updateSessionStatus(
  id: string,
  status: 'preparing' | 'ready' | 'active' | 'completed',
  completedAt?: string | null
): Promise<void> {
  const db = await getDatabase();
  const updatedAt = new Date().toISOString();
  if (status === 'completed') {
    const ts = completedAt || updatedAt;
    await db.runAsync(
      'UPDATE sessions SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?',
      status,
      ts,
      updatedAt,
      id
    );
  } else {
    await db.runAsync(
      'UPDATE sessions SET status = ?, error_note = NULL, updated_at = ? WHERE id = ?',
      status,
      updatedAt,
      id
    );
  }
}

/**
 * Updates the error note of a session.
 */
export async function updateSessionError(
  id: string,
  errorNote: string | null
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE sessions SET error_note = ? WHERE id = ?',
    errorNote,
    id
  );
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
  const latestBySession = new Map<string, string>();
  await db.withTransactionAsync(async () => {
    for (const op of ops) {
      await db.runAsync(
        `INSERT OR IGNORE INTO progress_ops (op_id, session_id, device_id, device_seq, cell_index, desired_state, base_revision, server_base_revision, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        op.opId,
        op.sessionId,
        op.deviceId,
        op.deviceSeq,
        op.cellIndex,
        op.desiredState,
        op.baseRevision,
        op.serverBaseRevision ?? 0,
        op.createdAt
      );
      const latest = latestBySession.get(op.sessionId);
      if (!latest || op.createdAt > latest) {
        latestBySession.set(op.sessionId, op.createdAt);
      }
    }
    for (const [sessionId, updatedAt] of latestBySession) {
      await db.runAsync(
        'UPDATE sessions SET updated_at = ? WHERE id = ?',
        updatedAt,
        sessionId
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
  const rows = await db.getAllAsync<ProgressOpRow>(
    'SELECT * FROM progress_ops WHERE session_id = ? AND base_revision >= ? ORDER BY device_seq ASC',
    sessionId,
    sinceRevision
  );

  return rows.map(mapProgressOpRow);
}

interface ProgressOpRow {
  op_id: string;
  session_id: string;
  device_id: string;
  device_seq: number;
  cell_index: number;
  desired_state: string;
  base_revision: number;
  server_base_revision: number | null;
  created_at: string;
}

function mapProgressOpRow(row: ProgressOpRow): ProgressOperation {
  return {
    opId: row.op_id,
    sessionId: row.session_id,
    deviceId: row.device_id,
    deviceSeq: row.device_seq,
    cellIndex: row.cell_index,
    desiredState: row.desired_state as 'completed' | 'incomplete',
    baseRevision: row.base_revision,
    serverBaseRevision: row.server_base_revision ?? 0,
    createdAt: row.created_at,
  };
}

/**
 * Returns this device's progress operations that the server has not yet
 * acknowledged, in creation order (device_seq ascending). These are the ops the
 * sync engine uploads.
 */
export async function getUnackedProgressOps(
  sessionId: string
): Promise<ProgressOperation[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ProgressOpRow>(
    'SELECT * FROM progress_ops WHERE session_id = ? AND acked = 0 ORDER BY device_seq ASC',
    sessionId
  );
  return rows.map(mapProgressOpRow);
}

/**
 * Marks the given operations as acknowledged by the server so they are not
 * re-uploaded. Folded server state lives in the sync snapshot, so acknowledged
 * ops are also removed to keep the local op-log bounded.
 */
export async function markProgressOpsAcked(opIds: string[]): Promise<void> {
  if (opIds.length === 0) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const opId of opIds) {
      await db.runAsync('DELETE FROM progress_ops WHERE op_id = ?', opId);
    }
  });
}

/**
 * Reads the server-authoritative folded snapshot for a session, if one exists.
 */
export async function getSyncSnapshot(
  sessionId: string
): Promise<SyncSnapshot | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    session_id: string;
    server_revision: number;
    packed_bitmap: Uint8Array | ArrayBuffer | number[];
    terminal: number;
    updated_at: string;
  }>('SELECT * FROM sync_snapshots WHERE session_id = ?', sessionId);
  if (!row) return null;
  return {
    sessionId: row.session_id,
    serverRevision: row.server_revision,
    packedBitmap: normalizePackedBitmap(row.packed_bitmap),
    terminal: row.terminal === 1,
    updatedAt: row.updated_at,
  };
}

/**
 * Persists the server-authoritative folded snapshot (upsert by session).
 */
export async function saveSyncSnapshot(
  sessionId: string,
  serverRevision: number,
  completed: Uint8Array,
  terminal: boolean
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO sync_snapshots (session_id, server_revision, packed_bitmap, terminal, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    sessionId,
    serverRevision,
    packCompletedBitmap(completed),
    terminal ? 1 : 0,
    new Date().toISOString()
  );
}

function normalizePackedBitmap(
  value: Uint8Array | ArrayBuffer | number[]
): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return new Uint8Array(value);
  return new Uint8Array(0);
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

/**
 * Deletes the database files (db, wal, shm) for a given identity from the device.
 */
export async function deleteNamespaceFiles(identity: string | null): Promise<void> {
  if (dbInstance && activeIdentity === identity) {
    try {
      await dbInstance.closeAsync();
    } catch (e) {
      console.error('Failed to close database instance before deletion:', e);
    }
    dbInstance = null;
    activeIdentity = null;
  }

  const documentDirectory = FileSystem.documentDirectory;
  if (!documentDirectory) {
    return;
  }

  const filename = getDatabaseFilename(identity);
  const dbPath = getDatabasePath(documentDirectory, filename);
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;

  const paths = [dbPath, walPath, shmPath];
  for (const path of paths) {
    try {
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) {
        await FileSystem.deleteAsync(path, { idempotent: true });
      }
    } catch (err) {
      console.error(`Failed to delete database file at ${path}:`, err);
    }
  }
}

export interface CatalogCacheEntry {
  surfaceKey: string;
  payloadJson: string;
  fetchedAt: string;
}

export async function getCatalogCache(surfaceKey: string): Promise<CatalogCacheEntry | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    surface_key: string;
    payload_json: string;
    fetched_at: string;
  }>('SELECT * FROM catalog_cache WHERE surface_key = ?', surfaceKey);

  if (!row) return null;
  return {
    surfaceKey: row.surface_key,
    payloadJson: row.payload_json,
    fetchedAt: row.fetched_at,
  };
}

export async function setCatalogCache(surfaceKey: string, payloadJson: string): Promise<void> {
  const db = await getDatabase();
  const fetchedAt = new Date().toISOString();
  await db.runAsync(
    'INSERT OR REPLACE INTO catalog_cache (surface_key, payload_json, fetched_at) VALUES (?, ?, ?)',
    surfaceKey,
    payloadJson,
    fetchedAt
  );
}

export async function addPendingCancel(remoteSessionId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'INSERT OR IGNORE INTO pending_cancels (remote_session_id) VALUES (?)',
    remoteSessionId
  );
}

export async function getPendingCancels(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ remote_session_id: string }>(
    'SELECT remote_session_id FROM pending_cancels'
  );
  return rows.map((row) => row.remote_session_id);
}

export async function removePendingCancel(remoteSessionId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM pending_cancels WHERE remote_session_id = ?',
    remoteSessionId
  );
}
