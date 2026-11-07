import type { StitchingSession } from '../../local-db';

const mockList = jest.fn();
const mockGetDeviceId = jest.fn();
const mockUpdateSessionError = jest.fn();
const mockSyncSession = jest.fn();
const mockRebuild = jest.fn();
const mockLoadBundledPattern = jest.fn();
const mockDeleteOfflinePatternFile = jest.fn();
const mockHandoffLoad = jest.fn();
const mockCapture = jest.fn();
let mockActiveIdentity: string | null;
let mockIdentity: { accountId: string | null; isAccount: boolean; isAuthenticated: boolean };

jest.mock('../../identity/guestIdentity', () => ({ useIdentityStore: { getState: () => mockIdentity } }));
jest.mock('../../local-db', () => ({
  getActiveIdentity: () => mockActiveIdentity,
  getDeviceId: mockGetDeviceId,
  listSessionsWithUnackedProgressOps: mockList,
  updateSessionError: mockUpdateSessionError,
}));
jest.mock('../progressSyncEngine', () => ({ syncSession: mockSyncSession }));
jest.mock('../progressBase', () => ({ rebuildProgressBase: mockRebuild }));
jest.mock('../../bundled-patterns', () => ({ loadBundledPattern: mockLoadBundledPattern }));
jest.mock('../../session-preparation', () => ({ deleteOfflinePatternFile: mockDeleteOfflinePatternFile }));
jest.mock('../../promotion/handoffStore', () => ({ handoffStore: { load: mockHandoffLoad } }));
jest.mock('../../observability/sentry', () => ({ captureProgressSyncError: mockCapture }));

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
  mockUpdateSessionError.mockResolvedValue(undefined);
  mockDeleteOfflinePatternFile.mockResolvedValue(undefined);
  mockRebuild.mockImplementation(async (_id: string, cells: number) => ({
    completed: new Uint8Array(cells),
    serverRevision: 3,
    sessionRevision: 1,
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
    expect(mockSyncSession).toHaveBeenNthCalledWith(1, 'a', 'remote_a', 'device-1', new Uint8Array(8));
    expect(mockSyncSession).toHaveBeenNthCalledWith(2, 'b', 'remote_b', 'device-1', new Uint8Array(9));
  });

  test('takes the size of a bundled row without stored dimensions from its pattern', async () => {
    mockList.mockResolvedValue([session('a', { source: 'bundled', patternWidth: null, patternHeight: null })]);
    mockLoadBundledPattern.mockResolvedValue({ width: 5, height: 5 });

    await uploader.uploadPendingProgress();

    expect(mockSyncSession).toHaveBeenCalledWith('a', 'remote_a', 'device-1', new Uint8Array(25));
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
