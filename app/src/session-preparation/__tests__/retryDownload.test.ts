import { retryDownload, UnlockRequiredError } from '../index';

jest.mock('../../local-db', () => ({
  getSession: jest.fn(),
  updateSessionStatus: jest.fn(),
  updateSessionError: jest.fn(),
}));

jest.mock('../../api/apiFetch', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({}));

const localDb = require('../../local-db');
const { apiFetch } = require('../../api/apiFetch');

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('retryDownload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localDb.getSession.mockResolvedValue({
      id: 'local-1',
      patternId: 'pattern-1',
      remoteSessionId: 'remote-1',
      artifactChecksum: 'chk',
    });
  });

  test('maps a 403 unlock_required refresh-grant response to UnlockRequiredError', async () => {
    apiFetch.mockResolvedValue(
      jsonResponse(403, { code: 'unlock_required', patternId: 'pattern-1', price: 50 }),
    );

    const failure = await retryDownload('local-1').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(UnlockRequiredError);
    expect(failure).toMatchObject({ patternId: 'pattern-1', price: 50 });
    expect(localDb.updateSessionError).toHaveBeenCalledWith('local-1', 'unlock_required');
  });

  test('keeps the generic error for other failures', async () => {
    apiFetch.mockResolvedValue(jsonResponse(500, {}));

    await expect(retryDownload('local-1')).rejects.toThrow('Failed to refresh grant: 500');
  });
});
