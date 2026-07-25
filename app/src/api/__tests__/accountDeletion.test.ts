import {
  getAccountDeletionStatus,
  requestAccountDeletion,
  cancelAccountDeletion,
  AccountDeletionApiError,
} from '../accountDeletion';
import {
  performAuthenticatedRequest,
  AccountClosingError,
  resetAccountDeletionTrigger,
} from '../authenticatedRequest';

// Mock apiFetch
jest.mock('../apiFetch', () => ({
  apiFetch: jest.fn(),
}));
const { apiFetch } = require('../apiFetch');

function jsonResponse(status: number, body: unknown): Response {
  const resp = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone: () => resp,
  };
  return resp as unknown as Response;
}

describe('Account Deletion API Client & Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAccountDeletionTrigger();
  });

  describe('Status Parsing', () => {
    test('parses status none response', async () => {
      apiFetch.mockResolvedValue(jsonResponse(200, { status: 'none' }));
      const result = await getAccountDeletionStatus();
      expect(result).toEqual({ status: 'none' });
      expect(apiFetch).toHaveBeenCalledWith('/v1/account/deletion');
    });

    test('parses status pending response with recovery window', async () => {
      const pendingData = {
        status: 'pending',
        requestedAt: '2026-07-25T10:00:00Z',
        recoveryWindowEndsAt: '2026-08-24T10:00:00Z',
      };
      apiFetch.mockResolvedValue(jsonResponse(200, pendingData));
      const result = await getAccountDeletionStatus();
      expect(result).toEqual(pendingData);
    });
  });

  describe('Request / Cancel Happy Paths', () => {
    test('request deletion returns pending status', async () => {
      const pendingData = {
        status: 'pending',
        requestedAt: '2026-07-25T10:00:00Z',
        recoveryWindowEndsAt: '2026-08-24T10:00:00Z',
      };
      apiFetch.mockResolvedValue(jsonResponse(200, pendingData));
      const result = await requestAccountDeletion();
      expect(result).toEqual(pendingData);
      expect(apiFetch).toHaveBeenCalledWith('/v1/account/deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });
    });

    test('cancel deletion returns none status', async () => {
      apiFetch.mockResolvedValue(jsonResponse(200, { status: 'none' }));
      const result = await cancelAccountDeletion();
      expect(result).toEqual({ status: 'none' });
      expect(apiFetch).toHaveBeenCalledWith('/v1/account/deletion/cancel', {
        method: 'POST',
      });
    });
  });

  describe('Error Mapping & Surface', () => {
    test('401 response mapped to reauthenticationRequired', async () => {
      apiFetch.mockResolvedValue(jsonResponse(401, { message: 'Reauthentication required' }));
      const promise = requestAccountDeletion();
      await expect(promise).rejects.toBeInstanceOf(AccountDeletionApiError);
      await expect(promise).rejects.toEqual(
        expect.objectContaining({
          status: 401,
          message: 'Reauthentication required',
          reauthenticationRequired: true,
        })
      );
    });

    test('403 ACCOUNT_CLOSING surfaced as a typed error from authenticated request', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue(jsonResponse(403, { code: 'ACCOUNT_CLOSING', message: 'Account is closing' }));

      const authSession = {
        getAccessToken: () => 'token',
        refreshSession: jest.fn(),
      };

      const promise = performAuthenticatedRequest('/test-path', {}, authSession);
      await expect(promise).rejects.toBeInstanceOf(AccountClosingError);
      await expect(promise).rejects.toThrow('Account is closing');

      global.fetch = globalFetch;
    });

    test('410 ACCOUNT_DELETED triggers onAccountDeleted exactly once', async () => {
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue(jsonResponse(410, { code: 'ACCOUNT_DELETED' }));

      const onAccountDeletedMock = jest.fn().mockResolvedValue(undefined);
      const authSession = {
        getAccessToken: () => 'token',
        refreshSession: jest.fn(),
        onAccountDeleted: onAccountDeletedMock,
      };

      // Perform two concurrent requests
      await Promise.all([
        performAuthenticatedRequest('/test-path-1', {}, authSession),
        performAuthenticatedRequest('/test-path-2', {}, authSession),
      ]);

      expect(onAccountDeletedMock).toHaveBeenCalledTimes(1);

      global.fetch = globalFetch;
    });
  });
});
