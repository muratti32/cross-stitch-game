import type { BundledRegistrationSnapshot } from '../../local-db';

const mockApiFetch = jest.fn();
const mockList = jest.fn();
const mockRead = jest.fn();
const mockLink = jest.fn();
const mockHandoffLoad = jest.fn();
const mockCapture = jest.fn();
let mockActiveIdentity: string | null;
let mockIdentity: { guestId: string | null; accountId: string | null; isAccount: boolean; isAuthenticated: boolean };

jest.mock('../../api/apiFetch', () => ({ apiFetch: mockApiFetch }));
jest.mock('../../identity/guestIdentity', () => ({ useIdentityStore: { getState: () => mockIdentity } }));
jest.mock('../../local-db', () => ({
  getActiveIdentity: () => mockActiveIdentity,
  linkBundledSession: mockLink,
  listBundledRegistrationCandidates: mockList,
  readBundledRegistrationSnapshot: mockRead,
}));
jest.mock('../../promotion/handoffStore', () => ({ handoffStore: { load: mockHandoffLoad } }));
jest.mock('../../observability/sentry', () => ({ captureBundledRegistrationError: mockCapture }));

const GUEST = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const REMOTE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HEART = 'dc47c329-35fd-4173-9ad9-5098369beb44';
const STAR = 'c2206f08-ef17-45d9-9cbb-ecd818a8dc06';
const BITMAP = 'Bw==';
const FULLER_BITMAP = 'Dw==';

type Registrar = typeof import('../bundledSessionRegistrar');
type Respond = { status: number; json: () => Promise<unknown> };

const snapshot = (overrides: Partial<BundledRegistrationSnapshot> = {}): BundledRegistrationSnapshot => ({
  localSessionId: 'row_heart',
  patternId: HEART,
  localState: 'in_progress',
  completedAt: null,
  packedBitmapBase64: BITMAP,
  foldedThroughSeq: 7,
  ...overrides,
});

const respond = (status: number, body: unknown): Respond => ({ status, json: async () => body });
const registered = (terminalCompleted = false, sessionId = REMOTE) => respond(200, { sessionId, terminalCompleted });

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function signInAccount(): void {
  mockIdentity = { guestId: null, accountId: ACCOUNT, isAccount: true, isAuthenticated: true };
  mockActiveIdentity = ACCOUNT;
}

function signInGuest(): void {
  mockIdentity = { guestId: GUEST, accountId: null, isAccount: false, isAuthenticated: true };
  mockActiveIdentity = GUEST;
}

function rows(...snapshots: BundledRegistrationSnapshot[]): void {
  mockList.mockResolvedValue(snapshots.map((row) => row.localSessionId));
  mockRead.mockImplementation(async (id: string) => snapshots.find((row) => row.localSessionId === id) ?? null);
}

const sentBodies = () => mockApiFetch.mock.calls.map(([, init]) => JSON.parse(init.body as string));

let registrar: Registrar;

beforeEach(() => {
  jest.resetAllMocks();
  jest.resetModules();
  mockHandoffLoad.mockResolvedValue(null);
  mockLink.mockImplementation(async (identity: string) => identity === mockActiveIdentity);
  mockApiFetch.mockResolvedValue(registered());
  signInAccount();
  registrar = require('../bundledSessionRegistrar') as Registrar;
});

describe('who registers what', () => {
  test('an account sends an unfinished row with its bitmap and acks what it folded', async () => {
    rows(snapshot());

    await registrar.registerBundledSessions();

    expect(mockApiFetch).toHaveBeenCalledWith('/v1/sessions/bundled', expect.objectContaining({ method: 'POST' }));
    expect(sentBodies()).toEqual([
      { patternId: HEART, localState: 'in_progress', completedAt: null, packedBitmapBase64: BITMAP },
    ]);
    expect(mockLink).toHaveBeenCalledWith(ACCOUNT, { localSessionId: 'row_heart', remoteSessionId: REMOTE }, 7);
  });

  test('an account sends a completed row with its bitmap and completion time', async () => {
    rows(snapshot({ localState: 'completed', completedAt: '2026-02-01T10:00:00.000Z' }));
    mockApiFetch.mockResolvedValue(registered(true));

    await registrar.registerBundledSessions();

    expect(sentBodies()).toEqual([
      { patternId: HEART, localState: 'completed', completedAt: '2026-02-01T10:00:00.000Z', packedBitmapBase64: BITMAP },
    ]);
    expect(mockLink).toHaveBeenCalledTimes(1);
  });

  test('an account row nobody stitched still carries the bitmap the backend requires', async () => {
    rows(snapshot({ packedBitmapBase64: '', foldedThroughSeq: 0 }));

    await registrar.registerBundledSessions();

    expect(sentBodies()[0].packedBitmapBase64).toBe('AA==');
    expect(mockLink).toHaveBeenCalledTimes(1);
  });

  test('a Guest sends identity only and links without acking any op', async () => {
    signInGuest();
    rows(snapshot());

    await registrar.registerBundledSessions();

    expect(sentBodies()).toEqual([{ patternId: HEART, localState: 'in_progress', completedAt: null, packedBitmapBase64: null }]);
    expect(mockLink).toHaveBeenCalledWith(GUEST, { localSessionId: 'row_heart', remoteSessionId: REMOTE }, 0);
  });

  test('a Guest leaves a completed row local and still registers the next one', async () => {
    signInGuest();
    rows(
      snapshot({ localState: 'completed', completedAt: '2026-02-01T10:00:00.000Z' }),
      snapshot({ localSessionId: 'row_star', patternId: STAR }),
    );

    await registrar.registerBundledSessions();

    expect(sentBodies().map((body) => body.patternId)).toEqual([STAR]);
    expect(mockLink).toHaveBeenCalledTimes(1);
  });
});

describe('when a pass runs at all', () => {
  test('before authentication nothing is read or sent', async () => {
    mockIdentity = { ...mockIdentity, isAuthenticated: false };
    rows(snapshot());

    await registrar.registerBundledSessions();

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  test('mid identity switch, with the namespace and the store apart, nothing is sent', async () => {
    mockActiveIdentity = GUEST;
    rows(snapshot());

    await registrar.registerBundledSessions();

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  test('any handoff skips the whole pass', async () => {
    mockHandoffLoad.mockResolvedValue({ phase: 'syncing' });
    rows(snapshot());

    await registrar.registerBundledSessions();

    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(mockLink).not.toHaveBeenCalled();
  });

  test('the pass runs once the handoff is gone', async () => {
    mockHandoffLoad.mockResolvedValueOnce({ phase: 'syncing' });
    rows(snapshot());

    await registrar.registerBundledSessions();
    await registrar.registerBundledSessions();

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });
});

describe('the link', () => {
  test('tells open sessions, and stops telling a listener that left', async () => {
    rows(snapshot());
    const listener = jest.fn();
    const leftEarly = jest.fn();
    registrar.subscribeBundledSessionLinked(listener);
    registrar.subscribeBundledSessionLinked(leftEarly)();

    await registrar.registerBundledSessions();

    expect(listener).toHaveBeenCalledWith({ localSessionId: 'row_heart', remoteSessionId: REMOTE });
    expect(leftEarly).not.toHaveBeenCalled();
  });

  test('is dropped when the identity changed during the request', async () => {
    rows(snapshot());
    const response = deferred<Respond>();
    mockApiFetch.mockReturnValue(response.promise);
    const listener = jest.fn();
    registrar.subscribeBundledSessionLinked(listener);

    const pass = registrar.registerBundledSessions();
    await new Promise(process.nextTick);
    signInGuest();
    response.resolve(registered());
    await pass;

    expect(mockLink).toHaveBeenCalledWith(ACCOUNT, expect.anything(), 7);
    await expect(mockLink.mock.results[0].value).resolves.toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  test('a crash before the link reruns the same registration and links', async () => {
    rows(snapshot());
    mockLink.mockRejectedValueOnce(new Error('killed'));
    const listener = jest.fn();
    registrar.subscribeBundledSessionLinked(listener);

    await registrar.registerBundledSessions();
    expect(listener).not.toHaveBeenCalled();

    await registrar.registerBundledSessions();

    const [first, second] = sentBodies();
    expect(second).toEqual(first);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('a row deleted during the request is not registered further', async () => {
    rows(snapshot());
    mockRead.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(null);

    await registrar.registerBundledSessions();

    expect(mockLink).not.toHaveBeenCalled();
  });
});

describe('a row that finishes while the request is out', () => {
  const finished = snapshot({
    localState: 'completed',
    completedAt: '2026-02-01T10:00:00.000Z',
    packedBitmapBase64: FULLER_BITMAP,
    foldedThroughSeq: 9,
  });

  test('an account registers it again as completed and links at the fresher fold', async () => {
    rows(snapshot());
    mockRead.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(finished);
    mockApiFetch.mockResolvedValueOnce(registered(false)).mockResolvedValueOnce(registered(true));

    await registrar.registerBundledSessions();

    expect(sentBodies().map((body) => [body.localState, body.packedBitmapBase64])).toEqual([
      ['in_progress', BITMAP],
      ['completed', FULLER_BITMAP],
    ]);
    expect(mockLink).toHaveBeenCalledWith(ACCOUNT, expect.anything(), 9);
  });

  test('a Guest leaves it local', async () => {
    signInGuest();
    rows(snapshot());
    mockRead.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(finished);

    await registrar.registerBundledSessions();

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockLink).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  test.each([
    ['an unseeded starter', 404, { code: 'starter_not_seeded' }],
    ['a promotion lock', 409, { message: 'locked' }],
    ['a bare 404 from a gateway', 404, { statusCode: 404, message: 'Cannot POST /v1/sessions/bundled' }],
    ['a 404 whose body is not JSON', 404, null],
    ['a 405', 405, {}],
  ])('%s stops the pass quietly and the next trigger retries', async (_label, status, body) => {
    rows(snapshot(), snapshot({ localSessionId: 'row_star', patternId: STAR }));
    mockApiFetch.mockResolvedValueOnce(respond(status, body));

    await registrar.registerBundledSessions();

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockLink).not.toHaveBeenCalled();

    await registrar.registerBundledSessions();

    expect(mockLink).toHaveBeenCalledTimes(2);
  });

  test('a row the backend calls no starter stops for that row, and the others go on', async () => {
    rows(snapshot(), snapshot({ localSessionId: 'row_star', patternId: STAR }));
    mockApiFetch.mockResolvedValueOnce(respond(404, { code: 'not_a_bundled_starter' }));

    await registrar.registerBundledSessions();
    await registrar.registerBundledSessions();

    expect(sentBodies().map((body) => body.patternId)).toEqual([HEART, STAR, STAR]);
    expect(mockLink).toHaveBeenCalledTimes(2);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  test('any other refusal goes to Sentry and retries later', async () => {
    rows(snapshot());
    mockApiFetch.mockResolvedValueOnce(respond(500, { code: 'boom' }));

    await registrar.registerBundledSessions();

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockLink).not.toHaveBeenCalled();

    await registrar.registerBundledSessions();

    expect(mockLink).toHaveBeenCalledTimes(1);
  });

  test('a 200 without a readable session id reports and links nothing', async () => {
    rows(snapshot());
    mockApiFetch.mockResolvedValueOnce(respond(200, { terminalCompleted: false }));

    await registrar.registerBundledSessions();

    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockLink).not.toHaveBeenCalled();
  });

  test('offline is quiet and retries later', async () => {
    rows(snapshot());
    mockApiFetch.mockRejectedValueOnce(new Error('Network request failed'));

    await expect(registrar.registerBundledSessions()).resolves.toBeUndefined();

    expect(mockCapture).not.toHaveBeenCalled();

    await registrar.registerBundledSessions();

    expect(mockLink).toHaveBeenCalledTimes(1);
  });

  test('a local failure never rejects the trigger', async () => {
    mockList.mockRejectedValue(new Error('database closed'));

    await expect(registrar.registerBundledSessions()).resolves.toBeUndefined();

    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  test('an unreadable handoff never rejects the trigger and sends nothing', async () => {
    rows(snapshot());
    mockHandoffLoad.mockRejectedValue(new Error('disk'));

    await expect(registrar.registerBundledSessions()).resolves.toBeUndefined();

    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});

describe('single flight', () => {
  test('calls during a pass share it and ask for one more, so a row created meanwhile is picked up', async () => {
    rows(snapshot());
    const response = deferred<Respond>();
    mockApiFetch.mockReturnValueOnce(response.promise);

    const first = registrar.registerBundledSessions();
    await new Promise(process.nextTick);
    const second = registrar.registerBundledSessions();
    const third = registrar.registerBundledSessions();

    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    rows(snapshot({ localSessionId: 'row_star', patternId: STAR }));
    response.resolve(registered());
    await Promise.all([first, second, third]);

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(sentBodies()[1].patternId).toBe(STAR);
  });

  test('a trigger after a failed pass starts a new one', async () => {
    rows(snapshot());
    mockList.mockRejectedValueOnce(new Error('database closed'));

    await registrar.registerBundledSessions();
    await registrar.registerBundledSessions();

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });
});
