import { getDatabaseFilename, shouldAdopt } from '../../local-db/namespaceLogic';
import { decodeJwt, calculateRefreshDelay, isTokenOlderThan12Minutes, shortenGuestId } from '../identityLogic';
import { adoptAccountSession, bootstrap, refreshSession, useIdentityStore, setAccessToken, getAccessToken, resetGuestData, removeLocalData, logout } from '../guestIdentity';
import { requestEmailOtp, verifyEmailOtp } from '../emailAuth';
import { exchangeFirebaseIdToken } from '../federatedAuth';
import { apiFetch } from '../../api/apiFetch';

const DECODABLE_JWT = 'h.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig';
const SESSION_ENVELOPE = 'stitch_wish.session_envelope_v1';

// Mock expo-secure-store
const mockSecureStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => {
  return {
    getItemAsync: jest.fn(async (key: string) => mockSecureStore[key] || null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      mockSecureStore[key] = value;
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete mockSecureStore[key];
    }),
  };
});

// Mock expo-crypto
jest.mock('expo-crypto', () => {
  return {
    randomUUID: jest.fn(() => 'mock-uuid-1234'),
    getRandomBytes: jest.fn((size: number) => {
      const arr = new Uint8Array(size);
      for (let i = 0; i < size; i++) arr[i] = i;
      return arr;
    }),
  };
});

// Mock local-db exports that call expo-sqlite / expo-file-system
jest.mock('../../local-db', () => {
  return {
    openNamespace: jest.fn(async () => {}),
    adoptPreIdentityDatabase: jest.fn(async () => {}),
    deleteNamespaceFiles: jest.fn(async () => {}),
  };
});

// Mock global fetch
let mockFetchResponses: Array<{ status: number; body: any }> = [];
let fetchCallCount = 0;
let fetchCalls: Array<{ url: string; options: any }> = [];

const originalFetch = global.fetch;

beforeAll(() => {
  global.fetch = jest.fn(async (url: any, options: any) => {
    fetchCallCount++;
    fetchCalls.push({ url, options });
    const response = mockFetchResponses.shift();
    if (!response) {
      return {
        status: 200,
        json: async () => ({}),
      } as any;
    }
    return {
      status: response.status,
      json: async () => response.body,
      clone() {
        return this;
      },
    } as any;
  }) as any;
});

afterAll(() => {
  global.fetch = originalFetch;
});

afterEach(() => {
  setAccessToken(null);
});

describe('Namespace Logic', () => {
  test('getDatabaseFilename maps correctly', () => {
    expect(getDatabaseFilename(null)).toBe('stitch_wish.db');
    expect(getDatabaseFilename('guest_123')).toBe('namespace_guest_guest_123.db');
  });

  test('shouldAdopt logic works', () => {
    expect(shouldAdopt(true, false)).toBe(true);
    expect(shouldAdopt(false, false)).toBe(false);
    expect(shouldAdopt(true, true)).toBe(false);
    expect(shouldAdopt(false, true)).toBe(false);
  });
});

describe('Identity Logic (Pure)', () => {
  test('decodeJwt decodes payload from standard JWT string', () => {
    const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const payload = 'eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9'; // {"id":"g1","iat":1000,"exp":1900}
    const signature = 'sig';
    const token = `${header}.${payload}.${signature}`;

    const decoded = decodeJwt(token);
    expect(decoded).toEqual({ id: 'g1', iat: 1000, exp: 1900 });
  });

  test('calculateRefreshDelay computes correct delay', () => {
    // iat = 1000, exp = 1900. Target refresh is iat + 720 = 1720
    expect(calculateRefreshDelay(1900, 1000, 1000)).toBe(720);
    expect(calculateRefreshDelay(1900, 1000, 1700)).toBe(20);
    expect(calculateRefreshDelay(1900, 1000, 1800)).toBe(0);
  });

  test('isTokenOlderThan12Minutes checks time correctly', () => {
    // iat = 1000. 12 minutes is 720 seconds. Older if now >= 1720
    expect(isTokenOlderThan12Minutes(1000, 1720)).toBe(true);
    expect(isTokenOlderThan12Minutes(1000, 1719)).toBe(false);
  });

  test('shortenGuestId truncates correctly', () => {
    expect(shortenGuestId('guest_uuid_longer_than_8')).toBe('guest_uu...');
    expect(shortenGuestId('short')).toBe('short');
  });
});

describe('Guest Identity Client State Machine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchResponses = [];
    fetchCallCount = 0;
    fetchCalls = [];
    // Clear mock storage
    for (const key of Object.keys(mockSecureStore)) {
      delete mockSecureStore[key];
    }
    // Reset Zustand store state
    useIdentityStore.setState({
      guestId: null,
      guestCreatedAt: null,
      accountId: null,
      accountEmail: null,
      accountProvider: null,
      isAccount: false,
      isAuthenticated: false,
      isPending: false,
      isOfflinePending: false,
      requiresSignIn: false,
    });
    setAccessToken(null);
  });

  test('single-flight: concurrent bootstrap calls produce one network invocation', async () => {
    mockFetchResponses.push({
      status: 201,
      body: {
        guestId: 'guest_abc',
        accessToken: 'access_abc.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig',
        refreshToken: 'refresh_abc',
      },
    });

    const p1 = bootstrap();
    const p2 = bootstrap();
    const p3 = bootstrap();

    await Promise.all([p1, p2, p3]);

    expect(fetchCallCount).toBe(1);
    expect(useIdentityStore.getState().guestId).toBe('guest_abc');
    expect(useIdentityStore.getState().isAuthenticated).toBe(true);
    expect(getAccessToken()).toBe('access_abc.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig');
  });

  test('expected connectivity failures do not emit background retry errors', async () => {
    jest.useFakeTimers();
    const fetchMock = global.fetch;
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('fetch failed: Could not connect to the server.')) as any;

      await expect(bootstrap()).rejects.toThrow('fetch failed');
      await jest.advanceTimersByTimeAsync(2000);

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        'Background retry bootstrap failed:',
        expect.anything(),
      );

      global.fetch = jest.fn().mockResolvedValue({
        status: 201,
        json: async () => ({
          guestId: 'guest_reconnected',
          accessToken: 'h.eyJpZCI6ImcxIn0.sig',
          refreshToken: 'refresh_reconnected',
        }),
      }) as any;
      await jest.advanceTimersByTimeAsync(4000);
    } finally {
      global.fetch = fetchMock;
      consoleErrorSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  test('adoption commits the account principal before resolving', async () => {
    await adoptAccountSession({
      accountId: 'acc_immediate',
      email: 'immediate@example.com',
      provider: 'email',
      accessToken: `access.${DECODABLE_JWT}`,
      refreshToken: 'refresh_immediate',
    });

    expect(useIdentityStore.getState()).toMatchObject({
      isAccount: true,
      accountId: 'acc_immediate',
      accountEmail: 'immediate@example.com',
    });
  });

  test('a late guest response cannot overwrite an adopted account', async () => {
    let resolveGuest: ((response: Response) => void) | undefined;
    const fetchMock = global.fetch;
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/v1/auth/guest')) {
        return new Promise<Response>((resolve) => { resolveGuest = resolve; });
      }
      return Promise.resolve({ status: 200, json: async () => ({}) } as Response);
    }) as typeof fetch;
    try {
      const guestBootstrap = bootstrap();
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
      await adoptAccountSession({
        accountId: 'acc_wins', email: 'wins@example.com', provider: 'email',
        accessToken: `access.${DECODABLE_JWT}`, refreshToken: 'refresh_wins',
      });
      resolveGuest?.({
        status: 201,
        json: async () => ({ guestId: 'late_guest', accessToken: 'late', refreshToken: 'late_refresh' }),
      } as Response);
      await guestBootstrap;
      expect(useIdentityStore.getState().accountId).toBe('acc_wins');
    } finally {
      global.fetch = fetchMock;
    }
  });

  test('bootstrap and refreshSession share one refresh request', async () => {
    mockSecureStore['stitch_wish.account_id'] = 'acc_single';
    mockSecureStore['stitch_wish.account_email'] = 'single@example.com';
    mockSecureStore['stitch_wish.refresh_token'] = 'refresh_single';
    let resolveRefresh: ((response: Response) => void) | undefined;
    const fetchMock = global.fetch;
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/v1/auth/refresh')) {
        return new Promise<Response>((resolve) => { resolveRefresh = resolve; });
      }
      return Promise.resolve({ status: 200, json: async () => ({}) } as Response);
    }) as typeof fetch;
    try {
      const first = bootstrap();
      const second = refreshSession();
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
      expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/v1/auth/refresh'))).toHaveLength(1);
      resolveRefresh?.({ status: 200, json: async () => ({ accessToken: `access.${DECODABLE_JWT}`, refreshToken: 'rotated' }) } as Response);
      await Promise.all([first, second]);
    } finally {
      global.fetch = fetchMock;
    }
  });

  test('bootstrap hydrates the cached account before refresh resolves', async () => {
    mockSecureStore['stitch_wish.account_id'] = 'acc_cached';
    mockSecureStore['stitch_wish.account_email'] = 'cached@example.com';
    mockSecureStore['stitch_wish.account_provider'] = 'email';
    mockSecureStore['stitch_wish.refresh_token'] = 'refresh_cached';
    let resolveRefresh: ((response: Response) => void) | undefined;
    const fetchMock = global.fetch;
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/v1/auth/refresh')) {
        return new Promise<Response>((resolve) => { resolveRefresh = resolve; });
      }
      return Promise.resolve({ status: 200, json: async () => ({}) } as Response);
    }) as typeof fetch;
    try {
      const pendingBootstrap = bootstrap();
      for (let tick = 0; tick < 40 && !resolveRefresh; tick += 1) await Promise.resolve();
      expect(useIdentityStore.getState()).toMatchObject({
        isAccount: true,
        accountId: 'acc_cached',
        isHydrated: true,
        isAuthenticated: false,
        isPending: true,
      });
      resolveRefresh?.({ status: 200, json: async () => ({ accessToken: `access.${DECODABLE_JWT}`, refreshToken: 'rotated_cached' }) } as Response);
      await pendingBootstrap;
    } finally {
      global.fetch = fetchMock;
    }
  });
});

describe('apiFetch Interception, Refresh and Replay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchResponses = [];
    fetchCallCount = 0;
    fetchCalls = [];
    setAccessToken(null);
    for (const key of Object.keys(mockSecureStore)) {
      delete mockSecureStore[key];
    }
    useIdentityStore.setState({
      guestId: 'guest_abc',
      isAuthenticated: true,
      requiresSignIn: false,
    });
  });

  test('attaches Authorization header if access token exists', async () => {
    setAccessToken('my-token.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig');
    mockFetchResponses.push({ status: 200, body: { success: true } });

    await apiFetch('/v1/session');

    expect(fetchCalls[0].options.headers.get('Authorization')).toBe(
      'Bearer my-token.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig'
    );
  });

  test('401 -> refresh -> replay success flow', async () => {
    setAccessToken('expired-token.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig');
    mockSecureStore['stitch_wish.refresh_token'] = 'old_refresh_token';

    // 1st request fails with 401
    mockFetchResponses.push({ status: 401, body: { error: 'Unauthorized' } });

    // Token refresh succeeds
    mockFetchResponses.push({
      status: 200,
      body: {
        accessToken: 'new-access-token.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig',
        refreshToken: 'new-refresh-token',
      },
    });

    // Replay succeeds
    mockFetchResponses.push({ status: 200, body: { data: 'ok' } });

    const res = await apiFetch('/v1/session');
    const json = await res.json();

    expect(json.data).toBe('ok');
    expect(fetchCallCount).toBe(3); // 1st try (401), token refresh (200), replayed try (200)
    expect(fetchCalls[2].options.headers.get('Authorization')).toBe(
      'Bearer new-access-token.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig'
    );
  });

  test('guest 401 -> refresh failure (401) -> clear session and re-bootstrap flow', async () => {
    setAccessToken('expired-token.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig');
    mockSecureStore['stitch_wish.refresh_token'] = 'invalid_refresh_token';
    mockSecureStore['stitch_wish.installation_key'] = 'inst_key';
    mockSecureStore['stitch_wish.credential_secret'] = 'cred_sec';

    // 1st request fails with 401
    mockFetchResponses.push({ status: 401, body: { error: 'Unauthorized' } });

    // Refresh fails with 401
    mockFetchResponses.push({ status: 401, body: { error: 'Refresh token invalid' } });

    // Re-bootstrap guest login succeeds
    mockFetchResponses.push({
      status: 201,
      body: {
        guestId: 'new_guest_xyz',
        accessToken: 'brand-new-access.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig',
        refreshToken: 'brand-new-refresh',
      },
    });

    const res = await apiFetch('/v1/session');

    // original 401 response is returned
    expect(res.status).toBe(401);

    // Wait for the re-bootstrap async chain to execute
    await new Promise(process.nextTick);

    expect(useIdentityStore.getState().guestId).toBe('new_guest_xyz');
    expect(useIdentityStore.getState().isAuthenticated).toBe(true);
    expect(getAccessToken()).toBe('brand-new-access.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig');
  });

  test('account 401 -> refresh failure requires sign-in instead of switching to guest', async () => {
    setAccessToken('expired-token.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig');
    mockSecureStore['stitch_wish.refresh_token'] = 'invalid_refresh_token';
    mockSecureStore['stitch_wish.account_id'] = 'account_expired';
    mockSecureStore['stitch_wish.account_email'] = 'expired@example.com';
    mockSecureStore['stitch_wish.account_provider'] = 'email';
    useIdentityStore.setState({
      accountId: 'account_expired',
      accountEmail: 'expired@example.com',
      accountProvider: 'email',
      isAccount: true,
      isAuthenticated: true,
    });

    mockFetchResponses.push({ status: 401, body: { error: 'Unauthorized' } });
    mockFetchResponses.push({ status: 401, body: { error: 'Refresh token invalid' } });

    const res = await apiFetch('/v1/creator-profiles/me');
    await new Promise(process.nextTick);

    expect(res.status).toBe(401);
    expect(mockFetchResponses).toHaveLength(0);
    expect(useIdentityStore.getState()).toMatchObject({
      accountId: null,
      isAccount: false,
      isAuthenticated: false,
      requiresSignIn: true,
    });
    expect(JSON.parse(mockSecureStore[SESSION_ENVELOPE])).toMatchObject({ requiresSignIn: true });
    expect(getAccessToken()).toBeNull();
  });

  test('account-only 403 marks a stale account state as sign-in required', async () => {
    setAccessToken('guest-token.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig');
    useIdentityStore.setState({
      accountId: 'account_stale',
      accountEmail: 'stale@example.com',
      accountProvider: 'email',
      isAccount: true,
      isAuthenticated: true,
    });
    mockFetchResponses.push({
      status: 403,
      body: { message: 'Registered Account required' },
    });

    const res = await apiFetch('/v1/creator-profiles/me');

    expect(res.status).toBe(403);
    expect(useIdentityStore.getState()).toMatchObject({
      accountId: null,
      isAccount: false,
      isAuthenticated: false,
      requiresSignIn: true,
    });
  });
});

describe('Guest Data Reset & Local Data Removal flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchResponses = [];
    fetchCallCount = 0;
    fetchCalls = [];
    // Reset Zustand store state
    useIdentityStore.setState({
      guestId: null,
      guestCreatedAt: null,
      isAuthenticated: false,
      isPending: false,
      isOfflinePending: false,
    });
    setAccessToken(null);
  });

  test('resetGuestData execution order and short-circuiting on server failure', async () => {
    const localDb = require('../../local-db');
    const deleteMock = localDb.deleteNamespaceFiles;

    // Set up a guest in store
    useIdentityStore.setState({
      guestId: 'guest_reset_test',
      isAuthenticated: true,
    });

    // Make the server call fail (not 204)
    mockFetchResponses.push({ status: 500, body: { error: 'Server error' } });

    await expect(resetGuestData()).rejects.toThrow();

    // Verify delete namespace was not called because it short-circuited
    expect(deleteMock).not.toHaveBeenCalled();

    // Now make it succeed
    setAccessToken('h.eyJpZCI6ImcxIn0.sig');
    mockFetchResponses.push({ status: 204, body: null });
    // Fetch response for bootstrap() which runs inside resetGuestData
    mockFetchResponses.push({
      status: 201,
      body: {
        guestId: 'new_guest_fresh',
        accessToken: 'new_access_token.eyJpZCI6ImcxIiwiaWF0IjoxMDAwLCJleHAiOjE5MDB9.sig',
        refreshToken: 'new_refresh_token',
      },
    });

    const fetchCallIndices: number[] = [];
    const deleteCallIndices: number[] = [];
    const recordedRequests: Array<{ url: unknown; options: any }> = [];

    // Track invocation order
    let callCounter = 0;
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation((url, options) => {
      fetchCallIndices.push(callCounter++);
      recordedRequests.push({ url, options });
      const res = mockFetchResponses.shift();
      return {
        status: res?.status ?? 200,
        json: async () => res?.body ?? {},
      } as any;
    });

    deleteMock.mockImplementation(() => {
      deleteCallIndices.push(callCounter++);
      return Promise.resolve();
    });

    await resetGuestData();

    // Verify fetch (server call) happened before deleteNamespaceFiles
    expect(fetchCallIndices.length).toBeGreaterThan(0);
    expect(deleteCallIndices.length).toBe(1);
    expect(fetchCallIndices[0]).toBeLessThan(deleteCallIndices[0]);
    expect(recordedRequests[0].options.headers.get('Authorization')).toBe(
      'Bearer h.eyJpZCI6ImcxIn0.sig',
    );

    // Restore original mock
    global.fetch = originalFetch;
  });

  test('removeLocalData namespace selection (guest vs pre-identity)', async () => {
    const localDb = require('../../local-db');
    const deleteMock = localDb.deleteNamespaceFiles;
    const openMock = localDb.openNamespace;

    // Case 1: Guest identity exists
    useIdentityStore.setState({
      guestId: 'guest_123',
      isAuthenticated: true,
    });
    
    await removeLocalData();
    expect(deleteMock).toHaveBeenCalledWith('guest_123');
    expect(openMock).toHaveBeenCalledWith('guest_123');

    jest.clearAllMocks();

    // Case 2: Pre-identity (no guestId)
    useIdentityStore.setState({
      guestId: null,
      isAuthenticated: false,
    });

    await removeLocalData();
    expect(deleteMock).toHaveBeenCalledWith(null);
    expect(openMock).toHaveBeenCalledWith(null);
  });
});

describe('Email Sign-In (Registered Account) flows', () => {
  const ACCOUNT_ID = 'stitch_wish.account_id';
  const ACCOUNT_EMAIL = 'stitch_wish.account_email';
  const ACCOUNT_PROVIDER = 'stitch_wish.account_provider';
  const REFRESH_TOKEN = 'stitch_wish.refresh_token';
  const GUEST_ID = 'stitch_wish.guest_id';

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchResponses = [];
    fetchCallCount = 0;
    fetchCalls = [];
    for (const key of Object.keys(mockSecureStore)) {
      delete mockSecureStore[key];
    }
    useIdentityStore.setState({
      guestId: null,
      guestCreatedAt: null,
      accountId: null,
      accountEmail: null,
      accountProvider: null,
      isAccount: false,
      isAuthenticated: false,
      isPending: false,
      isOfflinePending: false,
    });
    setAccessToken(null);
  });

  test('requestEmailOtp resolves on 202 and throws otherwise', async () => {
    mockFetchResponses.push({ status: 202, body: { status: 'sent' } });
    await expect(requestEmailOtp('User@Example.com')).resolves.toBeUndefined();
    expect(fetchCalls[0].url).toContain('/v1/auth/email/request');

    mockFetchResponses.push({ status: 500, body: {} });
    await expect(requestEmailOtp('user@example.com')).rejects.toThrow();
  });

  test('verifyEmailOtp adopts the account session on 200', async () => {
    const localDb = require('../../local-db');
    const openMock = localDb.openNamespace;
    mockSecureStore[GUEST_ID] = 'guest_old';

    mockFetchResponses.push({
      status: 200,
      body: {
        accountId: 'acc_123',
        accessToken: `access.${DECODABLE_JWT}`,
        refreshToken: 'refresh_acc',
      },
    });

    const result = await verifyEmailOtp('user@example.com', '123456');

    expect(result).toEqual({ kind: 'verified' });
    // Session identity now has one authoritative versioned envelope.
    expect(JSON.parse(mockSecureStore[SESSION_ENVELOPE])).toMatchObject({
      kind: 'account', accountId: 'acc_123', accountEmail: 'user@example.com',
      accountProvider: 'email', refreshToken: 'refresh_acc',
    });
    expect(mockSecureStore[GUEST_ID]).toBeUndefined();
    expect(openMock).toHaveBeenCalledWith('acc_123');

    const state = useIdentityStore.getState();
    expect(state.isAccount).toBe(true);
    expect(state.accountId).toBe('acc_123');
    expect(state.accountEmail).toBe('user@example.com');
    expect(state.accountProvider).toBe('email');
    expect(state.isAuthenticated).toBe(true);
    expect(getAccessToken()).toBe(`access.${DECODABLE_JWT}`);
  });

  test('verifyEmailOtp returns rejected on 401 without adopting a session', async () => {
    mockFetchResponses.push({ status: 401, body: {} });

    const result = await verifyEmailOtp('user@example.com', '000000');

    expect(result).toEqual({ kind: 'rejected' });
    expect(mockSecureStore[SESSION_ENVELOPE]).toBeUndefined();
    expect(useIdentityStore.getState().isAccount).toBe(false);
    expect(getAccessToken()).toBeNull();
  });

  test('exchangeFirebaseIdToken adopts a federated game session', async () => {
    const localDb = require('../../local-db');
    const openMock = localDb.openNamespace;
    mockFetchResponses.push({
      status: 200,
      body: {
        accountId: 'acc_google',
        accessToken: `access.${DECODABLE_JWT}`,
        email: 'google@example.com',
        provider: 'google',
        refreshToken: 'refresh_google',
      },
    });

    await exchangeFirebaseIdToken('firebase-id-token');

    expect(fetchCalls[0].url).toContain('/v1/auth/firebase/exchange');
    expect(JSON.parse(fetchCalls[0].options.body)).toEqual({
      idToken: 'firebase-id-token',
    });
    expect(JSON.parse(mockSecureStore[SESSION_ENVELOPE])).toMatchObject({
      kind: 'account', accountId: 'acc_google', accountEmail: 'google@example.com', accountProvider: 'google',
    });
    expect(openMock).toHaveBeenCalledWith('acc_google');
    expect(useIdentityStore.getState()).toMatchObject({
      accountId: 'acc_google',
      accountProvider: 'google',
      isAccount: true,
      isAuthenticated: true,
    });
  });

  test('bootstrap resumes an account session from stored ACCOUNT_ID', async () => {
    const localDb = require('../../local-db');
    const openMock = localDb.openNamespace;
    mockSecureStore['stitch_wish.installation_key'] = 'inst';
    mockSecureStore['stitch_wish.credential_secret'] = 'cred';
    mockSecureStore[ACCOUNT_ID] = 'acc_777';
    mockSecureStore[ACCOUNT_EMAIL] = 'saved@example.com';
    mockSecureStore[REFRESH_TOKEN] = 'refresh_saved';

    mockFetchResponses.push({
      status: 200,
      body: { accessToken: `access.${DECODABLE_JWT}`, refreshToken: 'refresh_next' },
    });

    await bootstrap();

    expect(fetchCallCount).toBe(1);
    expect(fetchCalls[0].url).toContain('/v1/auth/refresh');
    expect(openMock).toHaveBeenCalledWith('acc_777');
    const state = useIdentityStore.getState();
    expect(state.isAccount).toBe(true);
    expect(state.accountId).toBe('acc_777');
    expect(state.accountEmail).toBe('saved@example.com');
    expect(state.accountProvider).toBe('email');
    expect(state.guestId).toBeNull();
    expect(JSON.parse(mockSecureStore[SESSION_ENVELOPE]).refreshToken).toBe('refresh_next');
  });

  test('bootstrap requires sign-in when account refresh is revoked (401)', async () => {
    mockSecureStore['stitch_wish.installation_key'] = 'inst';
    mockSecureStore['stitch_wish.credential_secret'] = 'cred';
    mockSecureStore[ACCOUNT_ID] = 'acc_dead';
    mockSecureStore[ACCOUNT_EMAIL] = 'dead@example.com';
    mockSecureStore[REFRESH_TOKEN] = 'refresh_dead';

    // Account refresh rejected
    mockFetchResponses.push({ status: 401, body: {} });
    // Reproduce the real transition from a registered account to the guest
    // fallback while the profile screen is still mounted.
    useIdentityStore.setState({
      accountId: 'acc_dead',
      accountEmail: 'dead@example.com',
      accountProvider: 'email',
      isAccount: true,
    });

    await bootstrap();

    expect(JSON.parse(mockSecureStore[SESSION_ENVELOPE])).toMatchObject({
      kind: 'account', accountId: 'acc_dead', requiresSignIn: true, refreshToken: null,
    });
    const state = useIdentityStore.getState();
    expect(state.isAccount).toBe(false);
    expect(state.accountId).toBeNull();
    expect(state.accountEmail).toBeNull();
    expect(state.accountProvider).toBeNull();
    expect(state.guestId).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.requiresSignIn).toBe(true);
    expect(JSON.parse(mockSecureStore[SESSION_ENVELOPE])).toMatchObject({ requiresSignIn: true });
  });

  test('logout of an account clears keys but preserves namespace data', async () => {
    const localDb = require('../../local-db');
    const openMock = localDb.openNamespace;
    const deleteMock = localDb.deleteNamespaceFiles;
    mockSecureStore[ACCOUNT_ID] = 'acc_signout';
    mockSecureStore[ACCOUNT_EMAIL] = 'bye@example.com';
    mockSecureStore[ACCOUNT_PROVIDER] = 'apple';
    mockSecureStore[REFRESH_TOKEN] = 'refresh_signout';
    useIdentityStore.setState({
      accountId: 'acc_signout',
      accountEmail: 'bye@example.com',
      accountProvider: 'apple',
      isAccount: true,
      isAuthenticated: true,
    });

    // logout POSTs to /v1/auth/logout
    mockFetchResponses.push({ status: 204, body: null });

    await logout();

    expect(JSON.parse(mockSecureStore[SESSION_ENVELOPE])).toMatchObject({ kind: 'none', refreshToken: null });
    expect(openMock).toHaveBeenCalledWith(null);
    expect(deleteMock).not.toHaveBeenCalled();
    const state = useIdentityStore.getState();
    expect(state.isAccount).toBe(false);
    expect(state.accountId).toBeNull();
    expect(state.accountEmail).toBeNull();
    expect(state.accountProvider).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });
});
