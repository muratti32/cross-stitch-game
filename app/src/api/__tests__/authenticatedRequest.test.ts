import { performAuthenticatedRequest, resetAccountDeletionTrigger } from '../authenticatedRequest';
import { OfflineError } from '../networkErrors';
import i18n from '../../i18n/i18n';

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

// #160: the active App Display Language is attached to every outgoing
// request by this single shared API client, so no individual catalog call
// site has to add it (see src/api/catalog.ts, which no longer builds its own
// `locale` query param).
describe('performAuthenticatedRequest - active locale attachment', () => {
  const globalFetch = global.fetch;

  afterEach(async () => {
    global.fetch = globalFetch;
    await i18n.changeLanguage('en');
  });

  const authSession = {
    getAccessToken: () => null,
    refreshSession: jest.fn(),
  };

  test('attaches the active locale as a `locale` query param to a bare path', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, {}));

    await performAuthenticatedRequest('/v1/catalog/tags', {}, authSession);

    const requestedUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(requestedUrl).toMatch(/[?&]locale=en(&|$)/);
  });

  test('merges the locale onto a path that already carries query params', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, {}));

    await performAuthenticatedRequest(
      '/v1/catalog/patterns?category=animals&limit=10',
      {},
      authSession,
    );

    const requestedUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(requestedUrl).toContain('category=animals');
    expect(requestedUrl).toContain('limit=10');
    expect(requestedUrl).toMatch(/[?&]locale=en(&|$)/);
  });

  test('sends the currently active locale, not a hardcoded default', async () => {
    await i18n.changeLanguage('tr');
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, {}));

    await performAuthenticatedRequest('/v1/catalog/categories', {}, authSession);

    const requestedUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(requestedUrl).toMatch(/[?&]locale=tr(&|$)/);
  });

  test('attaches the locale again on the post-401 refresh retry', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(200, {}));

    const retrySession = {
      getAccessToken: () => 'stale-token',
      refreshSession: jest.fn().mockResolvedValue('new-token'),
    };

    await performAuthenticatedRequest('/v1/catalog/staff-picks', {}, retrySession);

    const retryUrl = (global.fetch as jest.Mock).mock.calls[1][0] as string;
    expect(retryUrl).toMatch(/[?&]locale=en(&|$)/);
  });
});
