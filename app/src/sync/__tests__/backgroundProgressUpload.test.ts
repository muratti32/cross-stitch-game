import type { StitchingSession } from '../../local-db';

const mockList = jest.fn();
const mockGetDeviceId = jest.fn();
const mockUpdateSessionError = jest.fn();
const mockGetUnacked = jest.fn();
const mockSyncSession = jest.fn();
const mockCompleteSession = jest.fn();
const mockListAwaiting = jest.fn();
const mockRebuild = jest.fn();
const mockLoadBundledPattern = jest.fn();
const mockDeleteOfflinePatternFile = jest.fn();
const mockHandoffLoad = jest.fn();
const mockCapture = jest.fn();
const mockBreadcrumb = jest.fn();
let mockActiveIdentity: string | null;
let mockIdentity: { accountId: string | null; isAccount: boolean; isAuthenticated: boolean };

jest.mock('../../identity/guestIdentity', () => ({ useIdentityStore: { getState: () => mockIdentity } }));
jest.mock('../../local-db', () => ({
  getActiveIdentity: () => mockActiveIdentity,
  getDeviceId: mockGetDeviceId,
  getUnackedProgressOps: mockGetUnacked,
  listSessionsWithUnackedProgressOps: mockList,
  listCompletedSessionsAwaitingTerminal: mockListAwaiting,
  updateSessionError: mockUpdateSessionError,
}));
jest.mock('../progressSyncEngine', () => ({ syncSession: mockSyncSession, completeSession: mockCompleteSession }));
jest.mock('../progressBase', () => ({ rebuildProgressBase: mockRebuild }));
jest.mock('../../bundled-patterns', () => ({ loadBundledPattern: mockLoadBundledPattern }));
jest.mock('../../session-preparation', () => ({ deleteOfflinePatternFile: mockDeleteOfflinePatternFile }));
jest.mock('../../promotion/handoffStore', () => ({ handoffStore: { load: mockHandoffLoad } }));
jest.mock('../../observability/sentry', () => ({ captureProgressSyncError: mockCapture, addProgressSyncBreadcrumb: mockBreadcrumb }));

const ACCOUNT = '22222222-2222-4222-8222-222222222222';

type Uploader = typeof import('../backgroundProgressUpload');

const session = (id: string, overrides: Partial<StitchingSession> = {}): StitchingSession => ({
  id,
  patternId: `pattern_${id}`,
  source: 'catalog',
  artifactChecksum: 'checksum',
  createdAt: '2026-02-01T10:00:00.000Z',
  updatedAt: '2026-02-01T10:00:00.000Z',
  status: 'active',
  remoteSessionId: `remote_${id}`,
  patternWidth: 4,
  patternHeight: 2,
  ...overrides,
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function statusError(status: number, code: string | null = null): Error {
  const { ProgressSyncError } = require('../../api/progressSync') as typeof import('../../api/progressSync');
  return new ProgressSyncError('failed', status, code);
}

const flush = (): Promise<void> => new Promise((done) => setImmediate(done));

let uploader: Uploader;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockActiveIdentity = ACCOUNT;
  mockIdentity = { accountId: ACCOUNT, isAccount: true, isAuthenticated: true };
  mockHandoffLoad.mockResolvedValue(null);
  mockGetDeviceId.mockResolvedValue('device-1');
  mockList.mockResolvedValue([]);
  mockListAwaiting.mockResolvedValue([]);
  mockCompleteSession.mockResolvedValue(true);
  mockGetUnacked.mockResolvedValue([]);
  mockUpdateSessionError.mockResolvedValue(undefined);
  mockDeleteOfflinePatternFile.mockResolvedValue(undefined);
  mockRebuild.mockImplementation(async (_id: string, cells: number) => ({
    completed: new Uint8Array(cells),
    serverRevision: 3,
    sessionRevision: 1,
    snapshotBytes: null,
  }));
  mockSyncSession.mockResolvedValue({
    serverRevision: 4,
    terminalCompleted: false,
    changedCells: [],
    conflictedCells: [],
    pullIncomplete: false,
  });
  uploader = require('../backgroundProgressUpload') as Uploader;
});

describe('uploadPendingProgress gate', () => {
  test.each([
    ['a guest', () => { mockIdentity = { accountId: null, isAccount: false, isAuthenticated: true }; }],
    ['an unauthenticated account', () => { mockIdentity = { ...mockIdentity, isAuthenticated: false }; }],
    ['an identity that is not the open namespace', () => { mockActiveIdentity = 'someone-else'; }],
    ['a pending promotion handoff', () => { mockHandoffLoad.mockResolvedValue({ pending: true }); }],
  ])('uploads nothing for %s', async (_label, arrange) => {
    arrange();
    mockList.mockResolvedValue([session('a')]);

    await uploader.uploadPendingProgress();

    expect(mockSyncSession).not.toHaveBeenCalled();
  });
});

describe('uploadPendingProgress', () => {
  test('syncs each listed session with its rebuilt bitmap and remote id', async () => {
    mockList.mockResolvedValue([session('a'), session('b', { patternWidth: 3, patternHeight: 3 })]);

    await uploader.uploadPendingProgress();

    expect(mockRebuild).toHaveBeenCalledWith('a', 8, true);
    expect(mockRebuild).toHaveBeenCalledWith('b', 9, true);
    expect(mockSyncSession).toHaveBeenNthCalledWith(1, 'a', 'remote_a', 'device-1', new Uint8Array(8), { maxPullPages: 1 });
    expect(mockSyncSession).toHaveBeenNthCalledWith(2, 'b', 'remote_b', 'device-1', new Uint8Array(9), { maxPullPages: 1 });
  });

  test('takes the size of a bundled row without stored dimensions from its pattern', async () => {
    mockList.mockResolvedValue([session('a', { source: 'bundled', patternWidth: null, patternHeight: null })]);
    mockLoadBundledPattern.mockResolvedValue({ width: 5, height: 5 });

    await uploader.uploadPendingProgress();

    expect(mockSyncSession).toHaveBeenCalledWith('a', 'remote_a', 'device-1', new Uint8Array(25), { maxPullPages: 1 });
  });

  test('leaves a row whose size cannot be known to the session screen', async () => {
    mockList.mockResolvedValue([
      session('a', { patternWidth: null, patternHeight: null }),
      session('b', { source: 'bundled', patternWidth: null, patternHeight: null }),
      session('c'),
    ]);
    mockLoadBundledPattern.mockRejectedValue(new Error('asset missing'));

    await uploader.uploadPendingProgress();

    expect(mockSyncSession.mock.calls.map((call) => call[0])).toEqual(['c']);
    expect(mockCapture).toHaveBeenCalledWith('background-upload-size', expect.any(Error));
  });

  test('skips a session the open session screen owns', async () => {
    mockList.mockResolvedValue([session('a'), session('b')]);
    uploader.markSessionOpen('a');

    await uploader.uploadPendingProgress();

    expect(mockSyncSession.mock.calls.map((call) => call[0])).toEqual(['b']);

    uploader.markSessionClosed('a');
    await uploader.uploadPendingProgress();

    expect(mockSyncSession.mock.calls.map((call) => call[0])).toEqual(['b', 'a', 'b']);
  });

  test('a 404 skips that session for the rest of the process and continues', async () => {
    mockList.mockResolvedValue([session('a'), session('b')]);
    mockSyncSession.mockRejectedValueOnce(statusError(404));

    await uploader.uploadPendingProgress();
    await uploader.uploadPendingProgress();

    expect(mockSyncSession.mock.calls.map((call) => call[0])).toEqual(['a', 'b', 'b']);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  test('a removed pattern records the error, wipes the offline file and is not retried', async () => {
    mockList.mockResolvedValue([session('a'), session('b')]);
    mockSyncSession.mockRejectedValueOnce(statusError(410, 'pattern_removed'));

    await uploader.uploadPendingProgress();
    await uploader.uploadPendingProgress();

    expect(mockUpdateSessionError).toHaveBeenCalledWith('a', 'This Community Pattern was removed by moderation.');
    expect(mockDeleteOfflinePatternFile).toHaveBeenCalledWith('pattern_a');
    expect(mockSyncSession.mock.calls.map((call) => call[0])).toEqual(['a', 'b', 'b']);
  });

  test('an offline failure stops the pass without reporting', async () => {
    mockList.mockResolvedValue([session('a'), session('b')]);
    mockSyncSession.mockRejectedValueOnce(new Error('Network request failed'));

    await expect(uploader.uploadPendingProgress()).resolves.toBeUndefined();

    expect(mockSyncSession.mock.calls.map((call) => call[0])).toEqual(['a']);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  test('any other failure is reported and the next session still uploads', async () => {
    mockList.mockResolvedValue([session('a'), session('b')]);
    const failure = statusError(500);
    mockSyncSession.mockRejectedValueOnce(failure);

    await expect(uploader.uploadPendingProgress()).resolves.toBeUndefined();

    expect(mockCapture).toHaveBeenCalledWith('background-upload', failure);
    expect(mockSyncSession.mock.calls.map((call) => call[0])).toEqual(['a', 'b']);
  });

  test('a failing listing never throws out of the pass', async () => {
    mockList.mockRejectedValue(new Error('db closed'));

    await expect(uploader.uploadPendingProgress()).resolves.toBeUndefined();

    expect(mockCapture).toHaveBeenCalledWith('background-upload', expect.any(Error));
  });

  test('overlapping calls share one pass and rerun once for the request made during it', async () => {
    const release = deferred<unknown>();
    mockList.mockResolvedValue([session('a')]);
    mockSyncSession.mockImplementationOnce(() => release.promise);

    const first = uploader.uploadPendingProgress();
    await Promise.resolve();
    const second = uploader.uploadPendingProgress();
    const third = uploader.uploadPendingProgress();
    release.resolve({ serverRevision: 4, terminalCompleted: false, changedCells: [], conflictedCells: [], pullIncomplete: false });
    await Promise.all([first, second, third]);

    expect(second).toBe(first);
    expect(mockSyncSession).toHaveBeenCalledTimes(2);
  });
});

describe('uploadPendingProgress safety', () => {
  const switchAway = (): void => {
    mockActiveIdentity = 'someone-else';
  };

  test('an identity switch during a sync stops the pass and refuses nothing', async () => {
    mockList.mockResolvedValue([session('a'), session('b')]);
    mockSyncSession.mockImplementationOnce(async () => {
      switchAway();
      throw statusError(404);
    });

    await uploader.uploadPendingProgress();
    mockActiveIdentity = ACCOUNT;
    await uploader.uploadPendingProgress();

    expect(mockSyncSession.mock.calls.map((call) => call[0])).toEqual(['a', 'a', 'b']);
  });

  test('a switch between the rebuild and the sync keeps the bitmap from being uploaded', async () => {
    mockList.mockResolvedValue([session('a')]);
    mockRebuild.mockImplementationOnce(async (_id: string, cells: number) => {
      switchAway();
      return { completed: new Uint8Array(cells), serverRevision: 3, sessionRevision: 1, snapshotBytes: null };
    });

    await uploader.uploadPendingProgress();

    expect(mockSyncSession).not.toHaveBeenCalled();
  });

  test('a handoff that appears mid-pass stops it', async () => {
    mockList.mockResolvedValue([session('a'), session('b')]);
    mockSyncSession.mockImplementationOnce(async () => {
      mockHandoffLoad.mockResolvedValue({ pending: true });
    });

    await uploader.uploadPendingProgress();

    expect(mockSyncSession.mock.calls.map((call) => call[0])).toEqual(['a']);
  });

  test('a failing removed-pattern cleanup is reported and the pass goes on', async () => {
    mockList.mockResolvedValue([session('a'), session('b')]);
    mockSyncSession.mockRejectedValueOnce(statusError(410, 'pattern_removed'));
    const failure = new Error('disk full');
    mockUpdateSessionError.mockRejectedValue(failure);

    await expect(uploader.uploadPendingProgress()).resolves.toBeUndefined();

    expect(mockCapture).toHaveBeenCalledWith('background-upload', failure);
    expect(mockSyncSession.mock.calls.map((call) => call[0])).toEqual(['a', 'b']);
  });

  test('a snapshot larger than the computed size is skipped and reported', async () => {
    mockList.mockResolvedValue([session('a'), session('b')]);
    mockRebuild.mockImplementationOnce(async (_id: string, cells: number) => ({
      completed: new Uint8Array(cells),
      serverRevision: 3,
      sessionRevision: 1,
      snapshotBytes: 3,
    }));

    await uploader.uploadPendingProgress();

    expect(mockSyncSession.mock.calls.map((call) => call[0])).toEqual(['b']);
    expect(mockBreadcrumb).toHaveBeenCalledWith(expect.stringContaining('larger'), { sessionId: 'a' });
  });

  test('a row of unknown size leaves a breadcrumb', async () => {
    mockList.mockResolvedValue([session('a', { patternWidth: null, patternHeight: null })]);

    await uploader.uploadPendingProgress();

    expect(mockBreadcrumb).toHaveBeenCalledWith(expect.stringContaining('size'), { sessionId: 'a' });
  });

  test('a session opened twice stays claimed until both screens close', async () => {
    mockList.mockResolvedValue([session('a')]);
    uploader.markSessionOpen('a');
    uploader.markSessionOpen('a');
    uploader.markSessionClosed('a');

    await uploader.uploadPendingProgress();
    expect(mockSyncSession).not.toHaveBeenCalled();

    uploader.markSessionClosed('a');
    await uploader.uploadPendingProgress();
    expect(mockSyncSession).toHaveBeenCalledTimes(1);
  });
});

describe('uploadPendingProgress backlog', () => {
  const unacked = (count: number): unknown[] => Array.from({ length: count }, (_, index) => ({ opId: `op${index}` }));

  test('keeps syncing a session while its backlog shrinks, then moves on', async () => {
    mockList.mockResolvedValue([session('a'), session('b')]);
    mockGetUnacked
      .mockResolvedValueOnce(unacked(600))
      .mockResolvedValueOnce(unacked(100))
      .mockResolvedValueOnce(unacked(0))
      .mockResolvedValue(unacked(0));

    await uploader.uploadPendingProgress();

    expect(mockSyncSession.mock.calls.map((call) => call[0])).toEqual(['a', 'a', 'a', 'b']);
  });

  test('gives up on a session whose backlog does not shrink', async () => {
    mockList.mockResolvedValue([session('a'), session('b')]);
    mockGetUnacked.mockResolvedValueOnce(unacked(500)).mockResolvedValueOnce(unacked(500));

    await uploader.uploadPendingProgress();

    expect(mockSyncSession.mock.calls.map((call) => call[0])).toEqual(['a', 'a', 'b']);
  });

  test('stops draining once a session screen claims the session', async () => {
    mockList.mockResolvedValue([session('a')]);
    mockGetUnacked.mockImplementationOnce(async () => {
      uploader.markSessionOpen('a');
      return unacked(100);
    });

    await uploader.uploadPendingProgress();

    expect(mockSyncSession).toHaveBeenCalledTimes(1);
  });

  test('stops draining when the account changed between rounds', async () => {
    mockList.mockResolvedValue([session('a')]);
    mockGetUnacked.mockImplementationOnce(async () => {
      mockActiveIdentity = 'someone-else';
      return unacked(100);
    });

    await uploader.uploadPendingProgress();

    expect(mockSyncSession).toHaveBeenCalledTimes(1);
  });

  test('a handoff check that throws ends the pass quietly instead of aborting it', async () => {
    mockList.mockResolvedValue([session('a'), session('b')]);
    const failure = new Error('storage unreadable');
    mockSyncSession.mockRejectedValueOnce(statusError(500));
    mockHandoffLoad
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockRejectedValue(failure);

    await expect(uploader.uploadPendingProgress()).resolves.toBeUndefined();

    expect(mockCapture).toHaveBeenCalledWith('background-upload', failure);
    expect(mockSyncSession).toHaveBeenCalledTimes(1);
  });
});

describe('waitForBackgroundSync', () => {
  test('resolves at once when nothing is syncing', async () => {
    await expect(uploader.waitForBackgroundSync('a')).resolves.toBeUndefined();
  });

  test('holds the session screen back until that session finishes uploading', async () => {
    const release = deferred<unknown>();
    mockList.mockResolvedValue([session('a')]);
    mockSyncSession.mockImplementationOnce(() => release.promise);
    const pass = uploader.uploadPendingProgress();
    await flush();

    let waited = false;
    const waiting = uploader.waitForBackgroundSync('a').then(() => { waited = true; });
    await Promise.resolve();
    expect(waited).toBe(false);

    release.resolve({ serverRevision: 4, terminalCompleted: false, changedCells: [], conflictedCells: [], pullIncomplete: false });
    await waiting;
    await pass;

    expect(waited).toBe(true);
  });
});

describe('uploadPendingProgress completion retry', () => {
  const done = (id: string, overrides: Partial<StitchingSession> = {}): StitchingSession =>
    session(id, { status: 'completed', ...overrides });

  const syncReturning = (...terminal: boolean[]): void => {
    terminal.forEach((terminalCompleted) =>
      mockSyncSession.mockResolvedValueOnce({
        serverRevision: 4,
        terminalCompleted,
        changedCells: [],
        conflictedCells: [],
        pullIncomplete: false,
      }),
    );
  };

  test('completes a drained completed session, then records the terminal state with a sync', async () => {
    mockListAwaiting.mockResolvedValue([done('a')]);
    syncReturning(false, true);

    await uploader.uploadPendingProgress();

    expect(mockCompleteSession).toHaveBeenCalledTimes(1);
    expect(mockCompleteSession).toHaveBeenCalledWith('remote_a', 'device-1');
    expect(mockSyncSession).toHaveBeenCalledTimes(2);
    expect(mockSyncSession.mock.invocationCallOrder[1]).toBeGreaterThan(mockCompleteSession.mock.invocationCallOrder[0]);
  });

  test('does not complete a session the server already finalized', async () => {
    mockListAwaiting.mockResolvedValue([done('a')]);
    syncReturning(true);

    await uploader.uploadPendingProgress();

    expect(mockCompleteSession).not.toHaveBeenCalled();
  });

  test('waits while unacked ops remain', async () => {
    mockListAwaiting.mockResolvedValue([done('a')]);
    mockGetUnacked.mockResolvedValue([{ opId: 'x' }]);
    syncReturning(false);

    await uploader.uploadPendingProgress();

    expect(mockCompleteSession).not.toHaveBeenCalled();
  });

  test('a 409 is retried on the next pass without a report', async () => {
    mockListAwaiting.mockResolvedValue([done('a'), done('b')]);
    syncReturning(false, false);
    mockCompleteSession.mockRejectedValueOnce(statusError(409, 'not_finished'));

    await uploader.uploadPendingProgress();
    expect(mockCompleteSession.mock.calls.map((call) => call[0])).toEqual(['remote_a', 'remote_b']);
    expect(mockCapture).not.toHaveBeenCalled();

    await uploader.uploadPendingProgress();
    expect(mockCompleteSession.mock.calls.map((call) => call[0])).toEqual(['remote_a', 'remote_b', 'remote_a', 'remote_b']);
  });

  test('an offline failure stops the pass quietly', async () => {
    mockListAwaiting.mockResolvedValue([done('a'), done('b')]);
    syncReturning(false);
    mockCompleteSession.mockRejectedValueOnce(new TypeError('Network request failed'));

    await uploader.uploadPendingProgress();

    expect(mockCompleteSession).toHaveBeenCalledTimes(1);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  test('a 404 refuses the session for the rest of the process', async () => {
    mockListAwaiting.mockResolvedValue([done('a')]);
    syncReturning(false);
    mockCompleteSession.mockRejectedValueOnce(statusError(404));

    await uploader.uploadPendingProgress();
    await uploader.uploadPendingProgress();

    expect(mockCompleteSession).toHaveBeenCalledTimes(1);
  });

  test('another failure is reported and the next session still completes', async () => {
    mockListAwaiting.mockResolvedValue([done('a'), done('b')]);
    syncReturning(false, false, true);
    mockCompleteSession.mockRejectedValueOnce(statusError(500));

    await uploader.uploadPendingProgress();

    expect(mockCapture).toHaveBeenCalledWith('background-upload', expect.any(Error));
    expect(mockCompleteSession).toHaveBeenCalledWith('remote_b', 'device-1');
  });

  test('leaves a session the open screen owns', async () => {
    mockListAwaiting.mockResolvedValue([done('a')]);
    uploader.markSessionOpen('a');

    await uploader.uploadPendingProgress();

    expect(mockCompleteSession).not.toHaveBeenCalled();
    expect(mockSyncSession).not.toHaveBeenCalled();
  });

  test.each([
    ['a guest', () => { mockIdentity = { accountId: null, isAccount: false, isAuthenticated: true }; }],
    ['another identity', () => { mockActiveIdentity = 'someone-else'; }],
    ['a pending promotion handoff', () => { mockHandoffLoad.mockResolvedValue({ pending: true }); }],
  ])('never completes for %s', async (_label, arrange) => {
    arrange();
    mockListAwaiting.mockResolvedValue([done('a')]);

    await uploader.uploadPendingProgress();

    expect(mockCompleteSession).not.toHaveBeenCalled();
  });

  test('an identity switch right before completion cancels it', async () => {
    mockListAwaiting.mockResolvedValue([done('a')]);
    mockSyncSession.mockImplementationOnce(async () => {
      mockActiveIdentity = 'someone-else';
      return { serverRevision: 4, terminalCompleted: false, changedCells: [], conflictedCells: [], pullIncomplete: false };
    });

    await uploader.uploadPendingProgress();

    expect(mockCompleteSession).not.toHaveBeenCalled();
  });

  test('a failing listing never throws out of the pass', async () => {
    mockListAwaiting.mockRejectedValue(new Error('db'));

    await expect(uploader.uploadPendingProgress()).resolves.toBeUndefined();
    expect(mockCapture).toHaveBeenCalledWith('background-upload', expect.any(Error));
  });
});
