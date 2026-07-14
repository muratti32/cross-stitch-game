import { getDatabaseFilename, shouldAdopt } from '../../local-db/namespaceLogic';
import { decodeJwt, calculateRefreshDelay, isTokenOlderThan12Minutes, shortenGuestId } from '../identityLogic';
import { bootstrap, refreshSession, useIdentityStore, setAccessToken, getAccessToken } from '../guestIdentity';
import { apiFetch } from '../../api/apiFetch';

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
      isAuthenticated: false,
      isPending: false,
      isOfflinePending: false,
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

  test('401 -> refresh failure (401) -> clear session and re-bootstrap flow', async () => {
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
});
