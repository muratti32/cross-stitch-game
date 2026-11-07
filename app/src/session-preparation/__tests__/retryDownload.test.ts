import {
  prepareCatalogSession,
  retryDownload,
  UnlockRequiredError,
  waitUntilSessionReady,
} from '../index';
import * as localDb from '../../local-db';
import { apiFetch } from '../../api/apiFetch';

jest.mock('../../local-db', () => ({
  findActiveSessionForPattern: jest.fn(),
  getSession: jest.fn(),
  updateSessionStatus: jest.fn(),
  updateSessionError: jest.fn(),
}));

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
