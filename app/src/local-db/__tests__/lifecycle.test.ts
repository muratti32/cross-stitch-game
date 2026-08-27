/**
 * Regression coverage for the expo-sqlite lifecycle crashes (GitHub #138-#146):
 * SIGSEGV in pthread_mutex_lock/sqlite3_reset, EXC_BAD_ACCESS in
 * SQLiteModule.finalize, SIGSEGV in sqlite3_exec, and an unhandled NPE out of
 * NativeDatabase.prepareAsync. All of these trace back to openNamespace()
 * closing the shared `dbInstance` handle while another in-flight query still
 * held a reference to it.
 *
 * These tests use a fake in-memory "native" database that throws if any
 * method is invoked after closeAsync() has resolved, so a regression here
 * fails loudly instead of only occasionally crashing under real timing.
 */

type FakeDb = {
  name: string;
  closed: boolean;
  execAsync: jest.Mock;
  getFirstAsync: jest.Mock;
  getAllAsync: jest.Mock;
  runAsync: jest.Mock;
  withTransactionAsync: jest.Mock;
  closeAsync: jest.Mock;
};

// Jest hoists jest.mock() factories above regular imports/declarations, but
// permits the factory to reference identifiers whose name starts with
// "mock" (see babel-plugin-jest-hoist). Everything the expo-sqlite mock
// needs lives on this prefix so the factory below can use it safely.
const mockCreatedDatabases: FakeDb[] = [];

function mockMakeFakeDb(filename: string): FakeDb {
  const db: FakeDb = {
    name: filename,
    closed: false,
    execAsync: jest.fn(async () => {
      if (db.closed) throw new Error(`use-after-close (execAsync) on ${filename}`);
    }),
    getFirstAsync: jest.fn(async () => {
      if (db.closed) throw new Error(`use-after-close (getFirstAsync) on ${filename}`);
      return undefined;
    }),
    getAllAsync: jest.fn(async () => {
      if (db.closed) throw new Error(`use-after-close (getAllAsync) on ${filename}`);
      return [];
    }),
    runAsync: jest.fn(async () => {
      if (db.closed) throw new Error(`use-after-close (runAsync) on ${filename}`);
    }),
    withTransactionAsync: jest.fn(async (action: () => Promise<void>) => {
      if (db.closed) throw new Error(`use-after-close (withTransactionAsync) on ${filename}`);
      await action();
    }),
    closeAsync: jest.fn(async () => {
      db.closed = true;
    }),
  };
  mockCreatedDatabases.push(db);
  return db;
}

jest.mock('expo-sqlite', () => {
  return {
    openDatabaseAsync: jest.fn(async (filename: string) => mockMakeFakeDb(filename)),
  };
});

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/docs/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  moveAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
}));

import { openNamespace, getSessions, getActiveIdentity } from '../index';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('local-db lifecycle serialization', () => {
  beforeEach(() => {
    mockCreatedDatabases.length = 0;
    jest.clearAllMocks();
  });

  it('opens exactly one handle when openNamespace is called concurrently with the same identity', async () => {
    const [dbA, dbB] = await Promise.all([openNamespace('guest-1'), openNamespace('guest-1')]);

    expect(dbA).toBe(dbB);
    expect(mockCreatedDatabases.length).toBe(1);
    expect(mockCreatedDatabases[0].closeAsync).not.toHaveBeenCalled();
    expect(getActiveIdentity()).toBe('guest-1');
  });

  it('serializes concurrent openNamespace calls for different identities without double-closing or leaving two open handles', async () => {
    const [dbA, dbB] = await Promise.all([openNamespace('guest-a'), openNamespace('guest-b')]);

    // Exactly two underlying handles were created (one per identity), and the
    // net result is a single active identity/handle - the loser of the race
    // was closed exactly once, never left dangling or double-closed.
    expect(mockCreatedDatabases.length).toBe(2);
    const closeCounts = mockCreatedDatabases.map((db) => db.closeAsync.mock.calls.length);
    expect(closeCounts.reduce((a, b) => a + b, 0)).toBe(1);
    closeCounts.forEach((count) => expect(count).toBeLessThanOrEqual(1));

    const finalIdentity = getActiveIdentity();
    expect(['guest-a', 'guest-b']).toContain(finalIdentity);
    const survivor = (finalIdentity === 'guest-a' ? dbA : dbB) as unknown as FakeDb;
    expect(survivor.closed).toBe(false);
  });

  it('never touches a closed handle: a query in flight during a close-under-load completes before the old handle closes', async () => {
    await openNamespace('guest-1');
    const firstDb = mockCreatedDatabases[0];

    const gate = deferred<void>();
    firstDb.getAllAsync.mockImplementationOnce(async () => {
      if (firstDb.closed) throw new Error('use-after-close (getAllAsync) on guest-1');
      await gate.promise;
      if (firstDb.closed) throw new Error('use-after-close (getAllAsync, post-await) on guest-1');
      return [];
    });

    // Start a slow query against the current handle, then race an identity
    // switch against it. The switch must wait for the query to finish before
    // it closes the old handle.
    const queryPromise = getSessions();
    const switchPromise = openNamespace('guest-2');

    // Give both promises a chance to start; the close must NOT have happened
    // yet because the query is still parked on the gate.
    await Promise.resolve();
    await Promise.resolve();
    expect(firstDb.closeAsync).not.toHaveBeenCalled();

    gate.resolve();
    await queryPromise;
    await switchPromise;

    expect(firstDb.closeAsync).toHaveBeenCalledTimes(1);
    expect(getActiveIdentity()).toBe('guest-2');
  });

  it('a query issued before a close either completes or rejects cleanly, but never runs against a closed handle', async () => {
    await openNamespace('guest-1');
    const firstDb = mockCreatedDatabases[0];

    const gate = deferred<void>();
    firstDb.getAllAsync.mockImplementationOnce(async () => {
      await gate.promise;
      return [];
    });

    const queryPromise = getSessions();
    const switchPromise = openNamespace('guest-2');

    gate.resolve();

    await expect(queryPromise).resolves.toEqual([]);
    await switchPromise;

    // The query's mocked getAllAsync never observed `closed === true`
    // because it resolved before the gate that guards closeAsync opened.
    expect(firstDb.closeAsync).toHaveBeenCalledTimes(1);
  });

  it('does not grant a new shared lease against the old handle once an exclusive op has been requested (no writer starvation)', async () => {
    await openNamespace('guest-1');
    const firstDb = mockCreatedDatabases[0];

    // Every call to getAllAsync on the OLD handle parks on its own gate, so we
    // can tell exactly how many times it was actually invoked.
    const gates: Array<{ promise: Promise<void>; resolve: () => void }> = [];
    firstDb.getAllAsync.mockImplementation(async () => {
      const gate = deferred<void>();
      gates.push(gate);
      await gate.promise;
      return [];
    });

    // q0 acquires a shared lease before any exclusive op exists.
    const q0 = getSessions();
    await Promise.resolve();
    await Promise.resolve();
    expect(firstDb.getAllAsync).toHaveBeenCalledTimes(1);

    // Request the identity switch. Under the buggy gate (grant-while-pending),
    // acquireShared() only checked `exclusiveActive`, which stays false for
    // the entire time this op is waiting on the shared-lease drain - so a
    // NEW query arriving here would still be handed a lease against the old
    // handle, and under continuous load `sharedCount` would never reach 0,
    // hanging this awaited call forever.
    const switchPromise = openNamespace('guest-2');
    await Promise.resolve();
    await Promise.resolve();

    // q1 is issued strictly AFTER the exclusive op was requested. It must be
    // parked, not granted - so getAllAsync must NOT have been called a
    // second time yet.
    const q1 = getSessions();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(firstDb.getAllAsync).toHaveBeenCalledTimes(1);

    // Let q0 drain so the exclusive op (and, transitively, q1) can proceed.
    gates[0].resolve();
    await q0;
    await switchPromise;

    expect(getActiveIdentity()).toBe('guest-2');
    expect(firstDb.closeAsync).toHaveBeenCalledTimes(1);

    // q1 only ever runs after the switch: it lands on the NEW handle, never
    // on the closed guest-1 handle.
    await q1;
    expect(firstDb.getAllAsync).toHaveBeenCalledTimes(1);
  });

  it('a steady stream of overlapping queries during an identity switch does not starve the switch indefinitely', async () => {
    await openNamespace('guest-1');
    // getAllAsync resolves immediately (default mock behavior) - the load is
    // "continuous" in the sense that a new pair of queries is fired before
    // the previous pair is awaited, so more than one shared lease can be
    // outstanding at any moment, matching steady stitch/progress write
    // traffic during gameplay.

    let switched = false;
    const switchPromise = openNamespace('guest-2').then((db) => {
      switched = true;
      return db;
    });

    const MAX_ITERATIONS = 200;
    let iterations = 0;
    async function overlappingLoad(): Promise<void> {
      while (!switched && iterations < MAX_ITERATIONS) {
        iterations++;
        const a = getSessions();
        const b = getSessions();
        await Promise.all([a, b]);
      }
    }

    // Bounded by MAX_ITERATIONS even if the switch never completes, so a
    // regression here fails the assertion below instead of hanging the
    // test process.
    await overlappingLoad();
    await switchPromise;

    expect(switched).toBe(true);
    // A correct writer-preferring gate lets the switch through almost
    // immediately once requested; under the starvation bug this hits
    // MAX_ITERATIONS instead.
    expect(iterations).toBeLessThan(10);
  });
});
