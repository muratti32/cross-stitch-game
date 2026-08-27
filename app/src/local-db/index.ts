import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system/legacy';
import { getDatabaseFilename, getDatabasePath, shouldAdopt } from './namespaceLogic';
import type { AnalyticsGameplayEvent, AnalyticsGameplayEventPayload } from '../analytics/schema';
import { markCriticalPathActivity } from '../perf/criticalPathSentinel';

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
  thumbnailUrl?: string | null;
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

export type GameplayEventKind = 'stitch_action' | 'color_completion';

export interface GameplayEvent {
  eventId: string;
  sessionId: string;
  kind: GameplayEventKind;
  dmcCode: string;
  clientSeq: number;
  occurredAt: string;
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

export interface PaletteEntry {
  dmcCode: string;
  name: string;
  rgbHex: string;
}

export interface EditorDraftSnapshot {
  gridBase64: string;
  palette: PaletteEntry[];
}

export interface EditorDraftHistory {
  snapshots: EditorDraftSnapshot[];
  cursor: number;
}

export interface EditorDraft {
  sourcePatternId: string;
  width: number;
  height: number;
  history: EditorDraftHistory;
  updatedAt: string;
}

export interface PendingPersonalPattern {
  patternId: string;
  sourcePatternId: string;
  title: string;
  width: number;
  height: number;
  palette: PaletteEntry[];
  gridBase64: string;
  createdAt: string;
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
 * ---------------------------------------------------------------------------
 * Access serialization
 * ---------------------------------------------------------------------------
 *
 * `dbInstance` is a single shared native handle. Two classes of operation touch
 * it:
 *   - "structural" operations (open / close / adopt) which replace or tear
 *     down the handle entirely, and
 *   - "query" operations (every runAsync/getAllAsync/getFirstAsync/
 *     prepareAsync/transaction call) which read the current handle and use it.
 *
 * Without coordination, a structural operation can call `closeAsync()` while a
 * query still holds a reference to the same handle, or two structural
 * operations can race each other (both missing the "already open" fast path
 * and both closing + reopening). That is a use-after-free on the native side:
 * SIGSEGV in pthread_mutex_lock/sqlite3_reset, EXC_BAD_ACCESS in
 * SQLiteModule.finalize, SIGSEGV in sqlite3_exec, and NPEs out of
 * NativeDatabase.prepareAsync all trace back to this race.
 *
 * This is a writer-preferring reader/writer gate:
 *   - any number of "shared" leases (queries) may be held concurrently against
 *     the current handle;
 *   - "exclusive" operations (structural changes) wait for every outstanding
 *     shared lease to drain before they touch `dbInstance`;
 *   - as soon as an exclusive operation is requested - even before it starts
 *     waiting for the drain - no *new* shared lease is granted until every
 *     currently pending-or-active exclusive operation has finished. This
 *     bounds the drain: once a structural op is queued, in-flight queries are
 *     still allowed to finish (they already hold their lease), but no new one
 *     can start and refill `sharedCount`, so it is guaranteed to reach 0.
 *     Without this, continuous query load (e.g. steady stitch/progress writes
 *     during gameplay) could keep granting new shared leases forever and an
 *     openNamespace()/adoptPreIdentityDatabase()/deleteNamespaceFiles() call
 *     would never proceed - trading the original use-after-free crash for an
 *     indefinite hang on identity switch, which is just as unacceptable.
 *   - exclusive operations are additionally serialized against each other via
 *     `exclusiveChain`, so concurrent openNamespace/adopt/delete calls never
 *     interleave.
 *
 * This gate is intentionally NOT reentrant: a caller that already holds a
 * shared lease must never try to acquire another one (it would queue behind
 * its own exclusive-pending check and deadlock). Every function in this file
 * that is called both as a public entry point (via withDatabase) and
 * internally by another such function is split into a `xWithDb(db, ...)`
 * helper that takes the already-acquired handle and never calls
 * withDatabase/acquireShared itself - see getSessionWithDb,
 * getLatestCheckpointWithDb, and getProgressOpsWithDb below.
 */

let sharedCount = 0;
let exclusiveActive = false;
let exclusivePending = 0;
let sharedWaiters: Array<() => void> = [];
let drainWaiters: Array<() => void> = [];
let exclusiveChain: Promise<void> = Promise.resolve();

function acquireShared(): Promise<void> {
  if (!exclusiveActive && exclusivePending === 0) {
    sharedCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    sharedWaiters.push(() => {
      sharedCount++;
      resolve();
    });
  });
}

function releaseShared(): void {
  sharedCount--;
  if (sharedCount === 0 && drainWaiters.length > 0) {
    const waiters = drainWaiters;
    drainWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
}

function waitForSharedDrain(): Promise<void> {
  if (sharedCount === 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    drainWaiters.push(resolve);
  });
}

/**
 * Runs `fn` as an exclusive structural operation: waits for every in-flight
 * shared lease (query) against the current handle to drain, serializes
 * against any other queued exclusive operation, and blocks new shared leases
 * from starting until `fn` completes. Failures are logged and rethrown - they
 * are never swallowed - so a failed open/close/adopt surfaces as a normal
 * rejection to whoever awaited it instead of vanishing or crashing a later,
 * unrelated query.
 */
function withExclusive<T>(fn: () => Promise<T>): Promise<T> {
  // Counted the instant the caller asks for exclusive access - not once it
  // actually starts running - so acquireShared() stops granting new leases
  // right away instead of only once this op reaches the front of
  // `exclusiveChain` and begins its own drain-wait.
  exclusivePending++;
  const run = exclusiveChain.then(
    () => runExclusive(fn),
    () => runExclusive(fn)
  );
  exclusiveChain = run.then(
    () => undefined,
    () => undefined
  );
  const onSettled = () => {
    exclusivePending--;
    // Only release queued shared waiters once no exclusive op is pending or
    // active anymore - otherwise a lease handed out here could still race a
    // different exclusive op that is next in `exclusiveChain`.
    if (exclusivePending === 0 && !exclusiveActive && sharedWaiters.length > 0) {
      const waiters = sharedWaiters;
      sharedWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  };
  run.then(onSettled, onSettled);
  return run;
}

async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  await waitForSharedDrain();
  exclusiveActive = true;
  try {
    return await fn();
  } catch (error) {
    console.error('Database structural operation failed:', error);
    throw error;
  } finally {
    exclusiveActive = false;
    // Shared leases are only released back to waiters once every
    // pending-or-active exclusive op has drained (see the exclusivePending
    // decrement in withExclusive) - not here. Waking them the instant THIS
    // op's `exclusiveActive` flips off would hand out leases while another
    // exclusive op is still queued right behind it, defeating the
    // writer-preference guarantee that bounds the next drain.
  }
}

/**
 * Acquires a shared lease on the currently open database and runs `fn` with
 * it. Opens the namespace lazily (matching the previous getDatabase()
 * behavior) if nothing is open yet. This is the sole internal access point for
 * every query in this module: it guarantees the handle passed to `fn` cannot
 * be closed out from under it, and that a failure is logged before it
 * propagates (never silently swallowed).
 */
async function withDatabase<T>(fn: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  for (;;) {
    if (!dbInstance) {
      await openNamespace(activeIdentity);
      continue;
    }
    await acquireShared();
    const db = dbInstance;
    if (!db) {
      // Closed by a structural operation between the check above and
      // acquiring the lease. Release and retry against whatever is open now.
      releaseShared();
      continue;
    }
    try {
      return await fn(db);
    } catch (error) {
      console.error('Database query failed:', error);
      throw error;
    } finally {
      releaseShared();
    }
  }
}

/**
 * Opens (or replaces) the current handle for `identity`, without acquiring
 * the exclusive lock itself. Callers must already hold it via withExclusive.
 */
async function openNamespaceLocked(identity: string | null): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance && activeIdentity === identity) {
    return dbInstance;
  }

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
  const opened = await SQLite.openDatabaseAsync(filename);
  dbInstance = opened;

  // Auto-initialize the newly opened database
  await initDatabaseForDb(opened);

  return opened;
}

/**
 * Namespace manager: openNamespace(identity) returns the DB handle for the active identity.
 * It closes the existing handle if the identity changes.
 *
 * Safe under concurrent calls: identical concurrent calls (same identity) are
 * serialized behind the exclusive lock and every one after the first just
 * observes the already-open handle via the fast path; concurrent calls with
 * different identities are likewise serialized so only one close+reopen ever
 * happens at a time, and no in-flight query can observe a half-closed handle.
 *
 * Note on iOS Storage Protection:
 * iOS database files created under the Documents/Library directories are protected by
 * default with iOS hardware-based Data Protection, ensuring encryption while locked.
 */
export async function openNamespace(identity: string | null): Promise<SQLite.SQLiteDatabase> {
  // Fast path outside the lock: avoids queuing behind the exclusive chain in
  // the overwhelmingly common case where nothing needs to change. Safe
  // because openNamespaceLocked() re-checks the same condition once it
  // actually holds the lock, so a race here just falls through to the lock.
  if (dbInstance && activeIdentity === identity) {
    return dbInstance;
  }
  return withExclusive(() => openNamespaceLocked(identity));
}

/**
 * Gets the open database instance, opening it if it doesn't exist yet.
 *
 * Kept for external callers (e.g. the perf harness) that need direct access to
 * the raw handle. Internal code in this module must use withDatabase()
 * instead, which additionally holds a lease for the duration of the query so
 * the handle cannot be closed underneath it.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  return withDatabase(async (db) => db);
}

let transactionQueue = Promise.resolve();

async function runInTransaction(
  db: SQLite.SQLiteDatabase,
  action: () => Promise<void>
): Promise<void> {
  const next = transactionQueue.then(async () => {
    return db.withTransactionAsync(action);
  });
  transactionQueue = next.then(
    () => {},
    () => {}
  );
  return next;
}

/**
 * Adopts the offline/pre-identity database as the target guest's database.
 * Moves the database file and WAL/SHM files atomically if the pre-identity database exists.
 *
 * Runs as a single exclusive operation end-to-end (close -> move files ->
 * reopen), so no concurrent query or other structural operation can observe
 * the intermediate state where the pre-identity handle is closed but the
 * guest namespace isn't open yet.
 */
export async function adoptPreIdentityDatabase(guestId: string): Promise<void> {
  const documentDirectory = FileSystem.documentDirectory;
  if (!documentDirectory) {
    // Web / mock fallback
    await openNamespace(guestId);
    return;
  }

  await withExclusive(async () => {
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
        try {
          await dbInstance.closeAsync();
        } catch (e) {
          console.error('Failed to close database instance before adoption:', e);
        }
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

    // 4. Open the new namespace (in the same exclusive op, so nobody can
    // observe the closed-but-not-yet-reopened gap).
    await openNamespaceLocked(guestId);
  });
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
    await runInTransaction(db, async () => {
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
    await runInTransaction(db, async () => {
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
    await runInTransaction(db, async () => {
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
    await runInTransaction(db, async () => {
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

  if (currentVersion < 5) {
    await runInTransaction(db, async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS gameplay_events (
          event_id TEXT PRIMARY KEY NOT NULL,
          session_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          dmc_code TEXT NOT NULL,
          client_seq INTEGER NOT NULL,
          occurred_at TEXT NOT NULL,
          acked INTEGER NOT NULL DEFAULT 0
        );
      `);
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS gameplay_event_seq (
          session_id TEXT PRIMARY KEY NOT NULL,
          seq INTEGER NOT NULL
        );
      `);
      await db.execAsync('PRAGMA user_version = 5;');
    });
  }

  if (currentVersion < 6) {
    await runInTransaction(db, async () => {
      // The undo/redo history is stored as a bounded array of FULL grid+palette snapshots (not an operation/diff log),
      // because Save-as-New edits include both single-cell recolors and "replace one DMC color throughout the whole grid"
      // bulk edits, and computing precise inverse operations for both correctly is unnecessary complexity when a capped
      // snapshot array gives correct, simple undo/redo at an acceptable storage cost for a single in-progress draft.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS editor_drafts (
          source_pattern_id TEXT PRIMARY KEY NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          history_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // pending_personal_patterns intentionally has NO sync_status column: rows are deleted immediately upon
      // successful sync (mirroring the existing pending_cancels outbox table's delete-on-ack idiom in this same file)
      // — a row's mere EXISTENCE means "not yet synced".
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS pending_personal_patterns (
          pattern_id TEXT PRIMARY KEY NOT NULL,
          source_pattern_id TEXT NOT NULL,
          title TEXT NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          palette_json TEXT NOT NULL,
          grid_base64 TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      await db.execAsync('PRAGMA user_version = 6;');
    });
  }

  if (currentVersion < 7) {
    await runInTransaction(db, async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS pattern_likes (
          pattern_id TEXT PRIMARY KEY NOT NULL,
          liked_at TEXT NOT NULL
        );
      `);
      await db.execAsync('PRAGMA user_version = 7;');
    });
  }

  if (currentVersion < 8) {
    await runInTransaction(db, async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS analytics_gameplay_events (
          event_id TEXT PRIMARY KEY NOT NULL,
          occurred_at TEXT NOT NULL,
          kind TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          dedupe_key TEXT UNIQUE
        );
      `);
      await db.execAsync('PRAGMA user_version = 8;');
    });
  }

  if (currentVersion < 9) {
    await runInTransaction(db, async () => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS analytics_session_ids (
          session_id TEXT PRIMARY KEY NOT NULL,
          analytics_session_id TEXT NOT NULL UNIQUE
        );
      `);
      await db.execAsync('PRAGMA user_version = 9;');
    });
  }

  if (currentVersion < 10) {
    await runInTransaction(db, async () => {
      await db.execAsync(`
        ALTER TABLE sessions ADD COLUMN thumbnail_url TEXT;
      `);
      await db.execAsync('PRAGMA user_version = 10;');
    });
  }
}

/**
 * Initializes the database tables and runs migrations.
 */
export async function initDatabase(): Promise<void> {
  await withDatabase((db) => initDatabaseForDb(db));
}

/**
 * Retrieves the device ID, generating it once if it doesn't exist yet.
 */
export async function getDeviceId(): Promise<string> {
  return withDatabase(async (db) => {
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
  });
}

/**
 * Retrieves the player's handedness layout preference, default to 'right'.
 */
export async function getHandedness(): Promise<'left' | 'right'> {
  return withDatabase(async (db) => {
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM device_config WHERE key = 'handedness'"
    );
    if (row && (row.value === 'left' || row.value === 'right')) {
      return row.value as 'left' | 'right';
    }
    return 'right';
  });
}

/**
 * Saves the player's handedness layout preference.
 */
export async function setHandedness(handedness: 'left' | 'right'): Promise<void> {
  await withDatabase(async (db) => {
    await db.runAsync(
      "INSERT OR REPLACE INTO device_config (key, value) VALUES ('handedness', ?)",
      handedness
    );
  });
}

export async function getDeviceConfigValue(key: string): Promise<string | null> {
  return withDatabase(async (db) => {
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM device_config WHERE key = ?',
      key,
    );
    return row?.value ?? null;
  });
}

export async function setDeviceConfigValue(key: string, value: string): Promise<void> {
  await withDatabase(async (db) => {
    await db.runAsync(
      'INSERT OR REPLACE INTO device_config (key, value) VALUES (?, ?)',
      key,
      value,
    );
  });
}

export async function setDeviceConfigValues(
  entries: readonly (readonly [key: string, value: string])[],
): Promise<void> {
  await withDatabase(async (db) => {
    await runInTransaction(db, async () => {
      for (const [key, value] of entries) {
        await db.runAsync(
          'INSERT OR REPLACE INTO device_config (key, value) VALUES (?, ?)',
          key,
          value,
        );
      }
    });
  });
}

/** Existing sessions or operations identify an upgraded install, not a first launch. */
export async function hasPlayHistory(): Promise<boolean> {
  return withDatabase(async (db) => {
    const row = await db.getFirstAsync<{ present: number }>(`
      SELECT EXISTS(
        SELECT 1 FROM sessions LIMIT 1
      ) OR EXISTS(
        SELECT 1 FROM progress_ops LIMIT 1
      ) AS present
    `);
    return row?.present === 1;
  });
}

/**
 * Checks if the player has seen the guest data risk notice.
 */
export async function hasSeenGuestDataRiskNotice(): Promise<boolean> {
  return withDatabase(async (db) => {
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM device_config WHERE key = 'guest_data_risk_notice_seen'"
    );
    return row?.value === '1';
  });
}

/**
 * Marks that the player has seen the guest data risk notice.
 */
export async function markGuestDataRiskNoticeSeen(): Promise<void> {
  await withDatabase(async (db) => {
    await db.runAsync(
      "INSERT OR REPLACE INTO device_config (key, value) VALUES ('guest_data_risk_notice_seen', '1')"
    );
  });
}


/**
 * Gets and increments the global monotonic sequence counter for this device.
 */
export async function getNextDeviceSeq(): Promise<number> {
  return withDatabase(async (db) => {
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
  });
}

/**
 * Reads the device's persistent monotonic sequence high-water mark. Unlike
 * MAX(device_seq) over progress_ops, this never regresses when acknowledged ops
 * are compacted away after a sync, so the server never mistakes a fresh op for a
 * replay of an already-applied sequence.
 */
export async function getDeviceSeqHigh(): Promise<number> {
  return withDatabase(async (db) => {
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM device_config WHERE key = 'device_seq'"
    );
    return row ? parseInt(row.value, 10) : 0;
  });
}

/**
 * Persists the device's monotonic sequence high-water mark.
 */
export async function setDeviceSeqHigh(value: number): Promise<void> {
  await withDatabase(async (db) => {
    await db.runAsync(
      "INSERT OR REPLACE INTO device_config (key, value) VALUES ('device_seq', ?)",
      value.toString()
    );
  });
}

/**
 * Creates a new stitching session in the SQLite database.
 */
export interface SessionPatternMeta {
  title: string;
  previewUrl: string | null;
  thumbnailUrl: string | null;
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
  return withDatabase(async (db) => {
    const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const createdAt = new Date().toISOString();

    await db.runAsync(
      `INSERT INTO sessions (id, pattern_id, source, artifact_checksum, created_at, updated_at, status, remote_session_id, title, preview_url, thumbnail_url, pattern_width, pattern_height)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      patternMeta?.thumbnailUrl ?? null,
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
      thumbnailUrl: patternMeta?.thumbnailUrl ?? null,
      patternWidth: patternMeta?.width ?? null,
      patternHeight: patternMeta?.height ?? null,
    };
  });
}

/**
 * Creates a replay session, linked to a completed session.
 */
export async function createReplaySession(
  parentSessionId: string
): Promise<StitchingSession> {
  return withDatabase(async (db) => {
    const parent = await getSessionWithDb(db, parentSessionId);
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
      `INSERT INTO sessions (id, pattern_id, source, artifact_checksum, created_at, updated_at, status, replay_of, title, preview_url, thumbnail_url, pattern_width, pattern_height)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      patternId,
      source,
      checksum,
      createdAt,
      createdAt,
      status,
      parentSessionId,
      parent.title ?? null,
      parent.previewUrl ?? null,
      parent.thumbnailUrl ?? null,
      parent.patternWidth ?? null,
      parent.patternHeight ?? null,
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
      title: parent.title ?? null,
      previewUrl: parent.previewUrl ?? null,
      thumbnailUrl: parent.thumbnailUrl ?? null,
      patternWidth: parent.patternWidth ?? null,
      patternHeight: parent.patternHeight ?? null,
    };
  });
}

export async function findActiveSessionForPattern(
  patternId: string,
  source: PatternSource,
): Promise<StitchingSession | null> {
  return withDatabase(async (db) => {
    const row = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM sessions WHERE pattern_id = ? AND source = ? AND status <> 'completed' ORDER BY created_at DESC",
      patternId,
      source,
    );
    if (!row) return null;
    return getSessionWithDb(db, row.id);
  });
}

export async function getSessions(): Promise<StitchingSession[]> {
  return withDatabase(async (db) => {
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
      thumbnail_url?: string | null;
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
      thumbnailUrl: row.thumbnail_url ?? null,
      patternWidth: row.pattern_width ?? null,
      patternHeight: row.pattern_height ?? null,
    }));
  });
}

async function getSessionWithDb(
  db: SQLite.SQLiteDatabase,
  id: string
): Promise<StitchingSession | null> {
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
    thumbnail_url?: string | null;
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
    thumbnailUrl: row.thumbnail_url ?? null,
    patternWidth: row.pattern_width ?? null,
    patternHeight: row.pattern_height ?? null,
  };
}

/**
 * Retrieves a single stitching session by its ID.
 */
export async function getSession(id: string): Promise<StitchingSession | null> {
  return withDatabase((db) => getSessionWithDb(db, id));
}

/**
 * Updates the status of a session, and completed_at if completed.
 */
export async function updateSessionStatus(
  id: string,
  status: 'preparing' | 'ready' | 'active' | 'completed',
  completedAt?: string | null
): Promise<void> {
  await withDatabase(async (db) => {
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
  });
}

/**
 * Replaces the cached Pattern Preview / Pattern Thumbnail urls of every session
 * that plays the given pattern.
 *
 * Personal Pattern image urls are short-lived signed grants, so the copy stored
 * at Session Preparation time stops resolving once the grant expires. Callers
 * re-issue the grants and write them back here. `updated_at` stays untouched so
 * refreshing images never reorders the Stitching Table.
 */
export async function updateSessionAssetUrls(
  patternId: string,
  source: PatternSource,
  urls: { previewUrl: string | null; thumbnailUrl: string | null }
): Promise<void> {
  await withDatabase(async (db) => {
    await db.runAsync(
      'UPDATE sessions SET preview_url = ?, thumbnail_url = ? WHERE pattern_id = ? AND source = ?',
      urls.previewUrl,
      urls.thumbnailUrl,
      patternId,
      source
    );
  });
}

/**
 * Updates the error note of a session.
 */
export async function updateSessionError(
  id: string,
  errorNote: string | null
): Promise<void> {
  await withDatabase(async (db) => {
    await db.runAsync(
      'UPDATE sessions SET error_note = ? WHERE id = ?',
      errorNote,
      id
    );
  });
}

/**
 * Deletes a session by its ID.
 */
export async function deleteSession(id: string): Promise<void> {
  await withDatabase(async (db) => {
    await db.runAsync('DELETE FROM sessions WHERE id = ?', id);
    await db.runAsync('DELETE FROM progress_ops WHERE session_id = ?', id);
    await db.runAsync('DELETE FROM checkpoints WHERE session_id = ?', id);
  });
}

/**
 * Inserts a batch of progress operations in a single SQLite transaction.
 */
export async function insertProgressOpsBatch(ops: ProgressOperation[]): Promise<void> {
  if (ops.length === 0) return;
  await withDatabase(async (db) => {
    const latestBySession = new Map<string, string>();
    await runInTransaction(db, async () => {
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
  });
}

/**
 * Retrieves all progress operations for a session since a specific base revision.
 */
async function getProgressOpsWithDb(
  db: SQLite.SQLiteDatabase,
  sessionId: string,
  sinceRevision: number = 0
): Promise<ProgressOperation[]> {
  const rows = await db.getAllAsync<ProgressOpRow>(
    'SELECT * FROM progress_ops WHERE session_id = ? AND base_revision >= ? ORDER BY device_seq ASC',
    sessionId,
    sinceRevision
  );

  return rows.map(mapProgressOpRow);
}

export async function getProgressOps(
  sessionId: string,
  sinceRevision: number = 0
): Promise<ProgressOperation[]> {
  return withDatabase((db) => getProgressOpsWithDb(db, sessionId, sinceRevision));
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
  return withDatabase(async (db) => {
    const rows = await db.getAllAsync<ProgressOpRow>(
      'SELECT * FROM progress_ops WHERE session_id = ? AND acked = 0 ORDER BY device_seq ASC',
      sessionId
    );
    return rows.map(mapProgressOpRow);
  });
}

/**
 * Marks the given operations as acknowledged by the server so they are not
 * re-uploaded. Folded server state lives in the sync snapshot, so acknowledged
 * ops are also removed to keep the local op-log bounded.
 */
export async function markProgressOpsAcked(opIds: string[]): Promise<void> {
  if (opIds.length === 0) return;
  markCriticalPathActivity('db-reconciliation', 'markProgressOpsAcked');
  await withDatabase(async (db) => {
    await runInTransaction(db, async () => {
      for (const opId of opIds) {
        await db.runAsync('DELETE FROM progress_ops WHERE op_id = ?', opId);
      }
    });
  });
}

export async function insertGameplayEventsBatch(events: GameplayEvent[]): Promise<void> {
  if (events.length === 0) return;
  await withDatabase(async (db) => {
    await runInTransaction(db, async () => {
      for (const event of events) {
        await db.runAsync(
          `INSERT OR IGNORE INTO gameplay_events (event_id, session_id, kind, dmc_code, client_seq, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          event.eventId,
          event.sessionId,
          event.kind,
          event.dmcCode,
          event.clientSeq,
          event.occurredAt,
        );
      }
    });
  });
}

export async function getUnackedGameplayEvents(limit: number): Promise<GameplayEvent[]> {
  return withDatabase(async (db) => {
    const rows = await db.getAllAsync<{
      event_id: string;
      session_id: string;
      kind: string;
      dmc_code: string;
      client_seq: number;
      occurred_at: string;
    }>(
      'SELECT event_id, session_id, kind, dmc_code, client_seq, occurred_at FROM gameplay_events WHERE acked = 0 ORDER BY rowid ASC LIMIT ?',
      limit,
    );
    return rows.map((row) => ({
      eventId: row.event_id,
      sessionId: row.session_id,
      kind: row.kind as GameplayEventKind,
      dmcCode: row.dmc_code,
      clientSeq: row.client_seq,
      occurredAt: row.occurred_at,
    }));
  });
}

export async function markGameplayEventsAcked(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  await withDatabase(async (db) => {
    await runInTransaction(db, async () => {
      for (const eventId of eventIds) {
        await db.runAsync('DELETE FROM gameplay_events WHERE event_id = ?', eventId);
      }
    });
  });
}

export const ANALYTICS_GAMEPLAY_EVENT_QUEUE_CAP = 2_000;

export function analyticsGameplayEventQueueOverflow(count: number): number {
  return Math.max(0, count - ANALYTICS_GAMEPLAY_EVENT_QUEUE_CAP);
}

/**
 * Stores the separate first-party analytics stream. At most 2,000 events are
 * retained per identity namespace: analytics is never a reward or progress
 * authority, so dropping the oldest records is safer than unbounded storage.
 */
export async function enqueueAnalyticsGameplayEvent(
  event: AnalyticsGameplayEvent,
): Promise<void> {
  await withDatabase(async (db) => {
    await runInTransaction(db, async () => {
      await db.runAsync(
        `INSERT OR IGNORE INTO analytics_gameplay_events
          (event_id, occurred_at, kind, payload_json, dedupe_key)
         VALUES (?, ?, ?, ?, ?)`,
        event.eventId,
        event.occurredAt,
        event.kind,
        JSON.stringify(event.payload),
        event.dedupeKey ?? null,
      );

      const countRow = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM analytics_gameplay_events',
      );
      const overflow = analyticsGameplayEventQueueOverflow(countRow?.count ?? 0);
      if (overflow > 0) {
        await db.runAsync(
          `DELETE FROM analytics_gameplay_events WHERE rowid IN (
            SELECT rowid FROM analytics_gameplay_events ORDER BY rowid ASC LIMIT ?
          )`,
          overflow,
        );
      }
    });
  });
}

export async function getUnackedAnalyticsGameplayEvents(
  limit: number,
): Promise<AnalyticsGameplayEvent[]> {
  return withDatabase(async (db) => {
    const rows = await db.getAllAsync<{
      event_id: string;
      occurred_at: string;
      kind: AnalyticsGameplayEvent['kind'];
      payload_json: string;
      dedupe_key: string | null;
    }>(
      `SELECT event_id, occurred_at, kind, payload_json, dedupe_key
       FROM analytics_gameplay_events ORDER BY rowid ASC LIMIT ?`,
      limit,
    );
    return rows.map((row) => ({
      eventId: row.event_id,
      occurredAt: row.occurred_at,
      kind: row.kind,
      payload: JSON.parse(row.payload_json) as AnalyticsGameplayEventPayload['payload'],
      dedupeKey: row.dedupe_key ?? undefined,
    }));
  });
}

export async function markAnalyticsGameplayEventsAcked(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  await withDatabase(async (db) => {
    await runInTransaction(db, async () => {
      for (const eventId of eventIds) {
        await db.runAsync(
          'DELETE FROM analytics_gameplay_events WHERE event_id = ?',
          eventId,
        );
      }
    });
  });
}

/**
 * Bundled/offline sessions use local ids that are not UUIDs. Persist a separate
 * opaque UUID once so their start and completion analytics records remain
 * schema-valid and correlated across restart without exposing pattern data.
 */
export async function getAnalyticsSessionId(sessionId: string): Promise<string> {
  return withDatabase(async (db) => {
    const existing = await db.getFirstAsync<{ analytics_session_id: string }>(
      'SELECT analytics_session_id FROM analytics_session_ids WHERE session_id = ?',
      sessionId,
    );
    if (existing) {
      return existing.analytics_session_id;
    }

    const analyticsSessionId = generateUUID();
    await runInTransaction(db, async () => {
      await db.runAsync(
        `INSERT OR IGNORE INTO analytics_session_ids (session_id, analytics_session_id)
         VALUES (?, ?)`,
        sessionId,
        analyticsSessionId,
      );
    });
    const created = await db.getFirstAsync<{ analytics_session_id: string }>(
      'SELECT analytics_session_id FROM analytics_session_ids WHERE session_id = ?',
      sessionId,
    );
    if (!created) {
      throw new Error('Could not persist analytics session identifier');
    }
    return created.analytics_session_id;
  });
}

export async function getGameplaySeqHigh(sessionId: string): Promise<number> {
  return withDatabase(async (db) => {
    const row = await db.getFirstAsync<{ seq: number }>(
      'SELECT seq FROM gameplay_event_seq WHERE session_id = ?',
      sessionId,
    );
    return row?.seq ?? 0;
  });
}

export async function setGameplaySeqHigh(sessionId: string, value: number): Promise<void> {
  await withDatabase(async (db) => {
    await db.runAsync(
      'INSERT OR REPLACE INTO gameplay_event_seq (session_id, seq) VALUES (?, ?)',
      sessionId,
      value,
    );
  });
}

/**
 * Reads the server-authoritative folded snapshot for a session, if one exists.
 */
export async function getSyncSnapshot(
  sessionId: string
): Promise<SyncSnapshot | null> {
  markCriticalPathActivity('db-reconciliation', 'getSyncSnapshot');
  return withDatabase(async (db) => {
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
  });
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
  markCriticalPathActivity('db-reconciliation', 'saveSyncSnapshot');
  await withDatabase(async (db) => {
    await db.runAsync(
      `INSERT OR REPLACE INTO sync_snapshots (session_id, server_revision, packed_bitmap, terminal, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      sessionId,
      serverRevision,
      packCompletedBitmap(completed),
      terminal ? 1 : 0,
      new Date().toISOString()
    );
  });
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
  await withDatabase(async (db) => {
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
  });
}

async function getLatestCheckpointWithDb(
  db: SQLite.SQLiteDatabase,
  sessionId: string
): Promise<Checkpoint | null> {
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
 * Retrieves the latest checkpoint for a session.
 */
export async function getLatestCheckpoint(
  sessionId: string
): Promise<Checkpoint | null> {
  return withDatabase((db) => getLatestCheckpointWithDb(db, sessionId));
}

/**
 * Retrieves the count of completed cells for a session by combining the latest checkpoint and any newer operations.
 */
export async function getSessionCompletedCount(
  sessionId: string,
  width: number,
  height: number
): Promise<number> {
  return withDatabase(async (db) => {
    const cellsLength = width * height;
    const checkpoint = await getLatestCheckpointWithDb(db, sessionId);
    let completed: Uint8Array;
    let revision = 0;
    if (checkpoint) {
      completed = unpackCompletedBitmap(checkpoint.packedBitmap, cellsLength);
      revision = checkpoint.revision;
    } else {
      completed = new Uint8Array(cellsLength);
    }

    const ops = await getProgressOpsWithDb(db, sessionId, revision);
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
  });
}

/**
 * Deletes the database files (db, wal, shm) for a given identity from the device.
 */
export async function deleteNamespaceFiles(identity: string | null): Promise<void> {
  await withExclusive(async () => {
    if (dbInstance && activeIdentity === identity) {
      try {
        await dbInstance.closeAsync();
      } catch (e) {
        console.error('Failed to close database instance before deletion:', e);
      }
      dbInstance = null;
      activeIdentity = null;
    }
  });

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
  return withDatabase(async (db) => {
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
  });
}

export async function setCatalogCache(surfaceKey: string, payloadJson: string): Promise<void> {
  await withDatabase(async (db) => {
    const fetchedAt = new Date().toISOString();
    await db.runAsync(
      'INSERT OR REPLACE INTO catalog_cache (surface_key, payload_json, fetched_at) VALUES (?, ?, ?)',
      surfaceKey,
      payloadJson,
      fetchedAt
    );
  });
}

export async function addPendingCancel(remoteSessionId: string): Promise<void> {
  await withDatabase(async (db) => {
    await db.runAsync(
      'INSERT OR IGNORE INTO pending_cancels (remote_session_id) VALUES (?)',
      remoteSessionId
    );
  });
}

export async function getPendingCancels(): Promise<string[]> {
  return withDatabase(async (db) => {
    const rows = await db.getAllAsync<{ remote_session_id: string }>(
      'SELECT remote_session_id FROM pending_cancels'
    );
    return rows.map((row) => row.remote_session_id);
  });
}

export async function removePendingCancel(remoteSessionId: string): Promise<void> {
  await withDatabase(async (db) => {
    await db.runAsync(
      'DELETE FROM pending_cancels WHERE remote_session_id = ?',
      remoteSessionId
    );
  });
}

export async function getEditorDraft(sourcePatternId: string): Promise<EditorDraft | null> {
  return withDatabase(async (db) => {
    const row = await db.getFirstAsync<{
      source_pattern_id: string;
      width: number;
      height: number;
      history_json: string;
      updated_at: string;
    }>('SELECT * FROM editor_drafts WHERE source_pattern_id = ?', sourcePatternId);

    if (!row) return null;
    return {
      sourcePatternId: row.source_pattern_id,
      width: row.width,
      height: row.height,
      history: JSON.parse(row.history_json),
      updatedAt: row.updated_at,
    };
  });
}

export async function saveEditorDraft(
  sourcePatternId: string,
  width: number,
  height: number,
  history: EditorDraftHistory,
): Promise<void> {
  await withDatabase(async (db) => {
    const updatedAt = new Date().toISOString();
    const historyJson = JSON.stringify(history);
    await db.runAsync(
      'INSERT OR REPLACE INTO editor_drafts (source_pattern_id, width, height, history_json, updated_at) VALUES (?, ?, ?, ?, ?)',
      sourcePatternId,
      width,
      height,
      historyJson,
      updatedAt,
    );
  });
}

export async function deleteEditorDraft(sourcePatternId: string): Promise<void> {
  await withDatabase(async (db) => {
    await db.runAsync('DELETE FROM editor_drafts WHERE source_pattern_id = ?', sourcePatternId);
  });
}

export async function addPendingPersonalPattern(record: PendingPersonalPattern): Promise<void> {
  await withDatabase(async (db) => {
    const paletteJson = JSON.stringify(record.palette);
    await db.runAsync(
      'INSERT OR IGNORE INTO pending_personal_patterns (pattern_id, source_pattern_id, title, width, height, palette_json, grid_base64, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      record.patternId,
      record.sourcePatternId,
      record.title,
      record.width,
      record.height,
      paletteJson,
      record.gridBase64,
      record.createdAt,
    );
  });
}

export async function getPendingPersonalPatterns(): Promise<PendingPersonalPattern[]> {
  return withDatabase(async (db) => {
    const rows = await db.getAllAsync<{
      pattern_id: string;
      source_pattern_id: string;
      title: string;
      width: number;
      height: number;
      palette_json: string;
      grid_base64: string;
      created_at: string;
    }>('SELECT * FROM pending_personal_patterns');

    return rows.map((row) => ({
      patternId: row.pattern_id,
      sourcePatternId: row.source_pattern_id,
      title: row.title,
      width: row.width,
      height: row.height,
      palette: JSON.parse(row.palette_json),
      gridBase64: row.grid_base64,
      createdAt: row.created_at,
    }));
  });
}

export async function removePendingPersonalPattern(patternId: string): Promise<void> {
  await withDatabase(async (db) => {
    await db.runAsync('DELETE FROM pending_personal_patterns WHERE pattern_id = ?', patternId);
  });
}

export async function setLocalPatternLike(patternId: string, liked: boolean): Promise<void> {
  await withDatabase(async (db) => {
    if (liked) {
      const likedAt = new Date().toISOString();
      await db.runAsync(
        'INSERT OR REPLACE INTO pattern_likes (pattern_id, liked_at) VALUES (?, ?)',
        patternId,
        likedAt
      );
    } else {
      await db.runAsync(
        'DELETE FROM pattern_likes WHERE pattern_id = ?',
        patternId
      );
    }
  });
}

export async function isLocalPatternLiked(patternId: string): Promise<boolean> {
  return withDatabase(async (db) => {
    const row = await db.getFirstAsync<{ pattern_id: string }>(
      'SELECT pattern_id FROM pattern_likes WHERE pattern_id = ?',
      patternId
    );
    return !!row;
  });
}

export async function getLocalPatternLikes(): Promise<Record<string, boolean>> {
  return withDatabase(async (db) => {
    const rows = await db.getAllAsync<{ pattern_id: string }>(
      'SELECT pattern_id FROM pattern_likes'
    );
    const result: Record<string, boolean> = {};
    for (const row of rows) {
      result[row.pattern_id] = true;
    }
    return result;
  });
}
