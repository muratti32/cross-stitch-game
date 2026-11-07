import {
  linkAwaitingSessions,
  prepareCatalogSession,
  preparePersonalSession,
  retryDownload,
  UnlockRequiredError,
  waitUntilSessionReady,
} from '../index';
import * as localDb from '../../local-db';
import { apiFetch } from '../../api/apiFetch';

jest.mock('../../local-db', () => ({
  findActiveSessionForPattern: jest.fn(),
  createSession: jest.fn(),
  getActiveIdentity: jest.fn(() => 'identity-1'),
  linkPreparedSession: jest.fn(),
  listSessionsAwaitingServerSession: jest.fn(),
  getSession: jest.fn(),
  updateSessionStatus: jest.fn(),
  updateSessionError: jest.fn(),
}));

const mockOwner = jest.fn();
const mockHandoffLoad = jest.fn();
jest.mock('../../sync/bundledSessionRegistrar', () => ({
  registerBundledSessions: jest.fn(),
  activeOwnerIdentity: () => mockOwner(),
}));
jest.mock('../../promotion/handoffStore', () => ({ handoffStore: { load: () => mockHandoffLoad() } }));

jest.mock('../../api/apiFetch', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({}));

const mockedDb = jest.mocked(localDb);
const mockedFetch = jest.mocked(apiFetch);

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const unlockBody = { code: 'unlock_required', patternId: 'pattern-1', price: 75 };

beforeEach(() => {
  jest.clearAllMocks();
  mockOwner.mockReturnValue('identity-1');
  mockHandoffLoad.mockResolvedValue(null);
  mockedDb.getSession.mockResolvedValue({
    id: 'local-1',
    patternId: 'pattern-1',
    remoteSessionId: 'remote-1',
    artifactChecksum: 'chk',
  } as never);
});

describe('retryDownload', () => {
  test('maps a 403 unlock_required refresh-grant response to UnlockRequiredError', async () => {
    mockedFetch.mockResolvedValue(jsonResponse(403, unlockBody));

    const failure = await retryDownload('local-1').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(UnlockRequiredError);
    expect(failure).toMatchObject({ patternId: 'pattern-1', price: 75 });
    expect(mockedDb.updateSessionError).toHaveBeenCalledWith('local-1', 'unlock_required');
  });

  test('keeps the generic error for other failures', async () => {
    mockedFetch.mockResolvedValue(jsonResponse(500, {}));

    await expect(retryDownload('local-1')).rejects.toThrow('Failed to refresh grant: 500');
  });
});

describe('prepareCatalogSession resuming a preparing session', () => {
  const info = { title: 'T', previewUrl: null, thumbnailUrl: null, width: 1, height: 1 };

  test('surfaces UnlockRequiredError from the grant refresh', async () => {
    mockedDb.findActiveSessionForPattern.mockResolvedValue({
      id: 'local-1',
      status: 'preparing',
    } as never);
    mockedFetch.mockResolvedValue(jsonResponse(403, unlockBody));

    await expect(prepareCatalogSession('pattern-1', info)).rejects.toBeInstanceOf(
      UnlockRequiredError,
    );
  });

  test('still resumes the session when the refresh fails for another reason', async () => {
    const existing = { id: 'local-1', status: 'preparing' };
    mockedDb.findActiveSessionForPattern.mockResolvedValue(existing as never);
    mockedFetch.mockResolvedValue(jsonResponse(500, {}));

    await expect(prepareCatalogSession('pattern-1', info)).resolves.toBe(existing);
  });
});

describe('a row the server never gave a session of its own', () => {
  const info = { title: 'T', previewUrl: null, thumbnailUrl: null, width: 1, height: 1 };
  const prepared = {
    sessionId: 'remote-2',
    artifact: { checksum: 'chk' },
    grant: { url: 'https://example.invalid/a' },
  };

  test('starting the pattern links the unlinked row from a fresh prepare, with nothing remembered in memory', async () => {
    const unlinked = { id: 'local-2', source: 'catalog', status: 'ready', remoteSessionId: null };
    mockedDb.findActiveSessionForPattern.mockResolvedValue(unlinked as never);
    mockedFetch.mockResolvedValue(jsonResponse(200, prepared));
    mockedDb.linkPreparedSession.mockResolvedValue(true);

    await expect(prepareCatalogSession('pattern-1', info)).resolves.toBe(unlinked);

    expect(mockedFetch).toHaveBeenCalledWith('/v1/sessions/prepare', expect.objectContaining({ method: 'POST' }));
    expect(mockedDb.linkPreparedSession).toHaveBeenCalledWith('identity-1', 'local-2', 'remote-2');
  });

  test('starting a linked row does not prepare again', async () => {
    mockedDb.findActiveSessionForPattern.mockResolvedValue({ id: 'local-9', status: 'ready', remoteSessionId: 'remote-9' } as never);

    await prepareCatalogSession('pattern-1', info);

    expect(mockedFetch).not.toHaveBeenCalled();
  });

  test('a failed link on start still plays the row', async () => {
    const unlinked = { id: 'local-2', source: 'catalog', status: 'ready', remoteSessionId: null };
    mockedDb.findActiveSessionForPattern.mockResolvedValue(unlinked as never);
    mockedFetch.mockRejectedValue(new Error('Network request failed'));

    await expect(prepareCatalogSession('pattern-1', info)).resolves.toBe(unlinked);
  });

  test('nothing is prepared or linked while no owner is signed in or a promotion handoff is open', async () => {
    const unlinked = { id: 'local-2', source: 'catalog', status: 'ready', remoteSessionId: null };
    mockedDb.findActiveSessionForPattern.mockResolvedValue(unlinked as never);
    mockedDb.listSessionsAwaitingServerSession.mockResolvedValue([unlinked] as never);

    mockOwner.mockReturnValue(null);
    await prepareCatalogSession('pattern-1', info);
    await linkAwaitingSessions();
    mockOwner.mockReturnValue('identity-1');
    mockHandoffLoad.mockResolvedValue({ handoff: true });
    await prepareCatalogSession('pattern-1', info);
    await linkAwaitingSessions();

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(mockedDb.linkPreparedSession).not.toHaveBeenCalled();
  });

  test('a refused personal row links on the next personal start', async () => {
    const unlinked = { id: 'local-3', source: 'personal', status: 'ready', remoteSessionId: null };
    mockedDb.findActiveSessionForPattern.mockResolvedValue(unlinked as never);
    mockedFetch.mockResolvedValue(jsonResponse(200, prepared));
    mockedDb.linkPreparedSession.mockResolvedValue(true);

    await expect(preparePersonalSession('pattern-1', info)).resolves.toBe(unlinked);

    expect(mockedDb.linkPreparedSession).toHaveBeenCalledWith('identity-1', 'local-3', 'remote-2');
  });

  test('a replay row is left unlinked on start', async () => {
    mockedDb.findActiveSessionForPattern.mockResolvedValue({ id: 'r', status: 'ready', remoteSessionId: null, replayOf: 'parent' } as never);

    await prepareCatalogSession('pattern-1', info);

    expect(mockedFetch).not.toHaveBeenCalled();
  });

  test('retryDownload prepares and links when the row has no server session', async () => {
    mockedDb.getSession.mockResolvedValue({ id: 'local-2', patternId: 'pattern-1', remoteSessionId: null, artifactChecksum: 'chk' } as never);
    mockedFetch.mockResolvedValue(jsonResponse(200, prepared));
    mockedDb.linkPreparedSession.mockResolvedValue(true);

    await retryDownload('local-2');

    expect(mockedFetch).toHaveBeenCalledWith('/v1/sessions/prepare', expect.objectContaining({ method: 'POST' }));
    expect(mockedDb.linkPreparedSession).toHaveBeenCalledWith('identity-1', 'local-2', 'remote-2');
  });

  test('the background pass links every awaiting row and survives one failing', async () => {
    mockedDb.listSessionsAwaitingServerSession.mockResolvedValue([
      { id: 'a', patternId: 'pattern-a', status: 'ready' },
      { id: 'b', patternId: 'pattern-b', status: 'completed' },
    ] as never);
    mockedFetch.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(jsonResponse(200, prepared));
    mockedDb.linkPreparedSession.mockResolvedValue(true);

    await expect(linkAwaitingSessions()).resolves.toBeUndefined();

    expect(mockedDb.linkPreparedSession).toHaveBeenCalledTimes(1);
    expect(mockedDb.linkPreparedSession).toHaveBeenCalledWith('identity-1', 'b', 'remote-2');
  });
});

describe('waitUntilSessionReady', () => {
  test('turns an unlock_required error note into UnlockRequiredError', async () => {
    mockedDb.getSession.mockResolvedValue({
      id: 'local-1',
      patternId: 'pattern-1',
      status: 'preparing',
      errorNote: 'unlock_required',
    } as never);

    await expect(waitUntilSessionReady('local-1', 1_000)).rejects.toBeInstanceOf(
      UnlockRequiredError,
    );
  });

  test('carries no invented price when the note has none', async () => {
    mockedDb.getSession.mockResolvedValue({
      id: 'local-1',
      patternId: 'pattern-1',
      status: 'preparing',
      errorNote: 'unlock_required',
    } as never);

    await expect(waitUntilSessionReady('local-1', 1_000)).rejects.toMatchObject({
      patternId: 'pattern-1',
      price: null,
    });
  });
});

describe('unlock_required response without a price', () => {
  test('maps a missing price to null, not 0', async () => {
    mockedFetch.mockResolvedValue(jsonResponse(403, { code: 'unlock_required', patternId: 'pattern-1' }));

    await expect(retryDownload('local-1')).rejects.toMatchObject({ price: null });
  });
});
