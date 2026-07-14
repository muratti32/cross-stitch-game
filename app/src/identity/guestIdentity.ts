import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Config } from '../config';
import { decodeJwt, calculateRefreshDelay, bufferToBase64Url } from './identityLogic';
import { adoptPreIdentityDatabase, openNamespace } from '../local-db';

const SECURE_KEYS = {
  INSTALLATION_KEY: 'stitch_wish.installation_key',
  CREDENTIAL_SECRET: 'stitch_wish.credential_secret',
  GUEST_ID: 'stitch_wish.guest_id',
  GUEST_CREATED_AT: 'stitch_wish.guest_created_at',
  REFRESH_TOKEN: 'stitch_wish.refresh_token',
};

// Memory-only access token
let memoryAccessToken: string | null = null;
let refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
let activeBootstrapPromise: Promise<void> | null = null;
let activeRefreshPromise: Promise<string> | null = null;

let retryDelay = 2000; // ms
let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Returns the memory-only access token.
 */
export function getAccessToken(): string | null {
  return memoryAccessToken;
}

/**
 * Sets the memory-only access token and handles proactive refresh scheduling.
 */
export function setAccessToken(token: string | null): void {
  memoryAccessToken = token;
  if (token) {
    scheduleProactiveRefresh(token);
  } else {
    clearRefreshSchedule();
  }
}

/**
 * Reads the refresh token from SecureStore.
 */
export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECURE_KEYS.REFRESH_TOKEN);
  } catch (err) {
    console.error('Failed to read refresh token from SecureStore:', err);
    return null;
  }
}

/**
 * Clears the scheduled proactive refresh timer.
 */
export function clearRefreshSchedule(): void {
  if (refreshTimeoutId) {
    clearTimeout(refreshTimeoutId);
    refreshTimeoutId = null;
  }
}

/**
 * Decodes the JWT and schedules a refresh ~12 minutes after issuance.
 */
function scheduleProactiveRefresh(token: string): void {
  clearRefreshSchedule();

  const payload = decodeJwt(token);
  if (!payload.exp || !payload.iat) {
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const delaySec = calculateRefreshDelay(payload.exp, payload.iat, nowSeconds);

  // Convert to ms
  const delayMs = delaySec * 1000;

  refreshTimeoutId = setTimeout(async () => {
    try {
      await refreshSession();
    } catch (err) {
      console.error('Proactive refresh failed:', err);
    }
  }, delayMs);
}

/**
 * Schedules a retry of the bootstrap process with exponential backoff.
 */
function scheduleRetryBootstrap(): void {
  if (retryTimeoutId) return;

  retryTimeoutId = setTimeout(() => {
    retryTimeoutId = null;
    bootstrap().catch((err) => {
      console.error('Background retry bootstrap failed:', err);
    });
  }, retryDelay);

  // Exponential backoff up to 30s
  retryDelay = Math.min(retryDelay * 2, 30000);
}

/**
 * Resets the exponential backoff retry state.
 */
function resetRetryDelay(): void {
  retryDelay = 2000;
  if (retryTimeoutId) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
}

export interface IdentityState {
  guestId: string | null;
  guestCreatedAt: string | null;
  isAuthenticated: boolean;
  isPending: boolean;
  isOfflinePending: boolean;
  bootstrap: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useIdentityStore = create<IdentityState>((set) => ({
  guestId: null,
  guestCreatedAt: null,
  isAuthenticated: false,
  isPending: false,
  isOfflinePending: false,

  bootstrap: async () => {
    await bootstrap();
  },

  logout: async () => {
    await logout();
  },
}));

function updateStoreState(updates: Partial<Omit<IdentityState, 'bootstrap' | 'logout'>>) {
  useIdentityStore.setState(updates);
}

/**
 * Bootstraps the guest identity. Collapses concurrent calls (single-flight).
 * Generates credentials if missing, attempts token refresh if refresh token exists,
 * or registers as a new/existing guest. Handles offline modes gracefully.
 */
export async function bootstrap(): Promise<void> {
  if (activeBootstrapPromise) {
    return activeBootstrapPromise;
  }

  activeBootstrapPromise = (async () => {
    updateStoreState({ isPending: true });

    try {
      // 1. Get or create installation credentials
      let installationKey = await SecureStore.getItemAsync(SECURE_KEYS.INSTALLATION_KEY);
      let credentialSecret = await SecureStore.getItemAsync(SECURE_KEYS.CREDENTIAL_SECRET);

      if (!installationKey || !credentialSecret) {
        installationKey = Crypto.randomUUID();
        const randomBytes = Crypto.getRandomBytes(32);
        credentialSecret = bufferToBase64Url(randomBytes);

        await SecureStore.setItemAsync(SECURE_KEYS.INSTALLATION_KEY, installationKey);
        await SecureStore.setItemAsync(SECURE_KEYS.CREDENTIAL_SECRET, credentialSecret);
      }

      // 2. Read stored guest identity details
      const savedGuestId = await SecureStore.getItemAsync(SECURE_KEYS.GUEST_ID);
      const savedGuestCreatedAt = await SecureStore.getItemAsync(SECURE_KEYS.GUEST_CREATED_AT);
      const refreshToken = await SecureStore.getItemAsync(SECURE_KEYS.REFRESH_TOKEN);

      // 3. Try to use existing refresh token if it exists
      if (refreshToken) {
        try {
          const tokens = await performRefreshRequest(refreshToken);
          setAccessToken(tokens.accessToken);
          await SecureStore.setItemAsync(SECURE_KEYS.REFRESH_TOKEN, tokens.refreshToken);

          // Open the namespace database for this guest
          await openNamespace(savedGuestId);

          updateStoreState({
            guestId: savedGuestId,
            guestCreatedAt: savedGuestCreatedAt,
            isAuthenticated: true,
            isPending: false,
            isOfflinePending: false,
          });

          resetRetryDelay();
          return;
        } catch (err: unknown) {
          if (hasHttpStatus(err) && err.status === 401) {
            // Revoked/expired refresh token family, clear and request guest auth
            await SecureStore.deleteItemAsync(SECURE_KEYS.REFRESH_TOKEN);
          } else {
            // Connectivity error
            updateStoreState({
              isPending: false,
              isOfflinePending: true,
            });
            scheduleRetryBootstrap();
            throw err;
          }
        }
      }

      // 4. Register/Login as guest using stored installation credentials
      try {
        const response = await fetch(`${Config.apiBaseUrl}/v1/auth/guest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            installationKey,
            credentialSecret,
          }),
        });

        if (response.status === 201) {
          const data = await response.json();
          const { guestId, accessToken, refreshToken: newRefreshToken } = data;
          const nowStr = new Date().toISOString();

          await SecureStore.setItemAsync(SECURE_KEYS.GUEST_ID, guestId);
          await SecureStore.setItemAsync(SECURE_KEYS.REFRESH_TOKEN, newRefreshToken);

          let createdAtVal = savedGuestCreatedAt;
          if (!createdAtVal) {
            createdAtVal = nowStr;
            await SecureStore.setItemAsync(SECURE_KEYS.GUEST_CREATED_AT, createdAtVal);
          }

          setAccessToken(accessToken);

          // Adopt the pre-identity database namespace for this guest (atomic file rename)
          await adoptPreIdentityDatabase(guestId);

          updateStoreState({
            guestId,
            guestCreatedAt: createdAtVal,
            isAuthenticated: true,
            isPending: false,
            isOfflinePending: false,
          });

          resetRetryDelay();
        } else if (response.status === 401) {
          // Credential rejected. Never purge or mint a new identity here — that
          // would silently orphan the player's server-side guest data. Guest
          // Data Reset is an explicit player action (issue #10). Surface a
          // pending state and let retries reuse the same stored credentials.
          console.warn('Backend rejected the stored guest credentials.');
          updateStoreState({
            isPending: false,
            isOfflinePending: true,
          });
          scheduleRetryBootstrap();
          return;
        } else {
          throw new Error(`Failed to register guest identity: server returned status ${response.status}`);
        }
      } catch (err) {
        // Network or server degradation - proceed offline-first
        updateStoreState({
          isPending: false,
          isOfflinePending: true,
        });
        scheduleRetryBootstrap();
        throw err;
      }
    } finally {
      updateStoreState({ isPending: false });
    }
  })().finally(() => {
    activeBootstrapPromise = null;
  });

  return activeBootstrapPromise;
}

/**
 * Performs token rotation refresh. Collapses concurrent calls (single-flight).
 */
export async function refreshSession(): Promise<string> {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const tokens = await performRefreshRequest(refreshToken);
      setAccessToken(tokens.accessToken);
      await SecureStore.setItemAsync(SECURE_KEYS.REFRESH_TOKEN, tokens.refreshToken);

      const guestId = await SecureStore.getItemAsync(SECURE_KEYS.GUEST_ID);
      const guestCreatedAt = await SecureStore.getItemAsync(SECURE_KEYS.GUEST_CREATED_AT);
      updateStoreState({
        guestId,
        guestCreatedAt,
        isAuthenticated: true,
        isOfflinePending: false,
      });

      return tokens.accessToken;
    } catch (err: unknown) {
      if (hasHttpStatus(err) && err.status === 401) {
        // Expired/rotated refresh token reuse detection: revoke all tokens and re-bootstrap
        console.warn('Refresh token is invalid or reuse detected. Revoking and re-bootstrapping.');
        await clearSessionStateOnly();
        bootstrap().catch((bErr) => {
          console.error('Re-bootstrap failure after refresh revocation:', bErr);
        });
      }
      throw err;
    }
  })().finally(() => {
    activeRefreshPromise = null;
  });

  return activeRefreshPromise;
}

/**
 * Clears the session states (access and refresh tokens) but keeps the guest credentials.
 * Used when a refresh token fails with 401.
 */
export async function clearSessionStateOnly(): Promise<void> {
  setAccessToken(null);
  await SecureStore.deleteItemAsync(SECURE_KEYS.REFRESH_TOKEN);
  updateStoreState({
    isAuthenticated: false,
  });
}

/**
 * Logs out the current guest. Calls the backend logout endpoint, clears
 * tokens, guest identity metadata, and switches the database namespace to null (pre-identity).
 */
export async function logout(): Promise<void> {
  const refreshToken = await getRefreshToken();
  if (refreshToken) {
    try {
      await fetch(`${Config.apiBaseUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refreshToken }),
      });
    } catch (err) {
      console.error('Backend logout request failed:', err);
    }
  }

  clearRefreshSchedule();
  resetRetryDelay();
  setAccessToken(null);

  await SecureStore.deleteItemAsync(SECURE_KEYS.REFRESH_TOKEN);
  await SecureStore.deleteItemAsync(SECURE_KEYS.GUEST_ID);
  await SecureStore.deleteItemAsync(SECURE_KEYS.GUEST_CREATED_AT);

  // Switch back to pre-identity database namespace
  await openNamespace(null);

  updateStoreState({
    guestId: null,
    guestCreatedAt: null,
    isAuthenticated: false,
    isOfflinePending: false,
  });
}

/**
 * Performs the refresh HTTP fetch.
 */
async function performRefreshRequest(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(`${Config.apiBaseUrl}/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refreshToken }),
  });

  if (response.status === 200) {
    return await response.json();
  }

  const err = new Error(
    `Token refresh failed: status ${response.status}`,
  ) as Error & { status: number };
  err.status = response.status;
  throw err;
}

function hasHttpStatus(err: unknown): err is { status: number } {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { status?: unknown }).status === 'number'
  );
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}
