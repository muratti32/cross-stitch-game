import { performAuthenticatedRequest, resetAccountDeletionTrigger } from '../authenticatedRequest';
import { OfflineError } from '../networkErrors';

function jsonResponse(status: number, body: unknown): Response {
  const resp = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone: () => resp,
  };
  return resp as unknown as Response;
}

describe('performAuthenticatedRequest - offline handling', () => {
  const globalFetch = global.fetch;

  beforeEach(() => {
    resetAccountDeletionTrigger();
  });

  afterEach(() => {
    global.fetch = globalFetch;
  });

  test('converts a thrown offline fetch failure into a typed OfflineError', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Network request failed'));

    const authSession = {
      getAccessToken: () => null,
      refreshSession: jest.fn(),
    };

    const promise = performAuthenticatedRequest('/test-path', {}, authSession);
    await expect(promise).rejects.toBeInstanceOf(OfflineError);
    await expect(promise).rejects.toThrow(
      'Network request failed because the device appears to be offline.',
    );
  });

  test('converts the iOS NSURLErrorNotConnectedToInternet message (#152) into an OfflineError', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new Error('Error performing request because the internet connection appears to be offline.'),
      );

    const authSession = {
      getAccessToken: () => null,
      refreshSession: jest.fn(),
    };

    await expect(
      performAuthenticatedRequest('/test-path', {}, authSession),
    ).rejects.toBeInstanceOf(OfflineError);
  });

  test('converts the iOS WebKit fetch shim message (#153) into an OfflineError', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(
        new Error('A network error has occurred. The Internet connection appears to be offline.'),
      );

    const authSession = {
      getAccessToken: () => null,
      refreshSession: jest.fn(),
    };

    await expect(
      performAuthenticatedRequest('/test-path', {}, authSession),
    ).rejects.toBeInstanceOf(OfflineError);
  });

  test('leaves a genuine backend failure (thrown Error) unconverted', async () => {
    const backendError = new Error('boom');
    global.fetch = jest.fn().mockRejectedValue(backendError);

    const authSession = {
      getAccessToken: () => null,
      refreshSession: jest.fn(),
    };

    const promise = performAuthenticatedRequest('/test-path', {}, authSession);
    await expect(promise).rejects.toBe(backendError);
    await expect(promise).rejects.not.toBeInstanceOf(OfflineError);
  });

  test('an HTTP 500 response is not converted to OfflineError - it resolves normally', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(500, { message: 'Internal error' }));

    const authSession = {
      getAccessToken: () => null,
      refreshSession: jest.fn(),
    };

    const response = await performAuthenticatedRequest('/test-path', {}, authSession);
    expect(response.status).toBe(500);
  });

  test('an offline failure during the post-401 refresh retry still surfaces as OfflineError', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockRejectedValueOnce(new TypeError('Network request failed'));

    const authSession = {
      getAccessToken: () => 'stale-token',
      refreshSession: jest.fn().mockResolvedValue('new-token'),
    };

    const promise = performAuthenticatedRequest('/test-path', {}, authSession);
    await expect(promise).rejects.toBeInstanceOf(OfflineError);
  });
});
