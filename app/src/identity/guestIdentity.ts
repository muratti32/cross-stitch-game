import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Config } from '../config';
import { decodeJwt, calculateRefreshDelay, bufferToBase64Url } from './identityLogic';
import { adoptPreIdentityDatabase, openNamespace, deleteNamespaceFiles } from '../local-db';
import { performAuthenticatedRequest, resetAccountDeletionTrigger } from '../api/authenticatedRequest';
import { useGameplayStore } from '../store';
import { queryClient } from '../providers';
import {
  clearSessionEnvelope,
  emptySessionEnvelope,
  readSessionEnvelope,
  type SessionEnvelope,
  type SessionStore,
  writeSessionEnvelope,
} from './sessionEnvelope';
import {
  advanceGeneration,
  captureGeneration,
  createSessionLifecycle,
  isCurrentGeneration,
} from './sessionLifecycle';

const SECURE_KEYS = {
  INSTALLATION_KEY: 'stitch_wish.installation_key',
  CREDENTIAL_SECRET: 'stitch_wish.credential_secret',
  GUEST_ID: 'stitch_wish.guest_id',
  GUEST_CREATED_AT: 'stitch_wish.guest_created_at',
  REFRESH_TOKEN: 'stitch_wish.refresh_token',
  REQUIRES_SIGN_IN: 'stitch_wish.requires_sign_in',
  // Registered Account (email sign-in). When ACCOUNT_ID is present, the active
  // session belongs to a Registered Account rather than a Guest Installation.
  // The account id doubles as the Local Identity Namespace key, so signing back
  // into the same account reopens its unsynchronized local data.
  ACCOUNT_ID: 'stitch_wish.account_id',
  ACCOUNT_EMAIL: 'stitch_wish.account_email',
  ACCOUNT_PROVIDER: 'stitch_wish.account_provider',
};

const sessionStore: SessionStore = SecureStore;
const lifecycle = createSessionLifecycle();

export type AccountProvider = 'apple' | 'email' | 'google';

// Memory-only access token
let memoryAccessToken: string | null = null;
let refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
let activeBootstrapPromise: Promise<void> | null = null;
let activeRefreshPromise: Promise<string> | null = null;

let retryDelay = 2000; // ms
let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

function isConnectivityError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('fetch failed') ||
    message.includes('Network request failed') ||
    message.includes('Could not connect to the server')
  );
}

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
    return (await readEnvelope()).refreshToken;
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
      if (!isConnectivityError(err)) {
        console.error('Background retry bootstrap failed:', err);
      }
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
  accountId: string | null;
  accountEmail: string | null;
  accountProvider: AccountProvider | null;
  isAccount: boolean;
  isAuthenticated: boolean;
  isPending: boolean;
  isOfflinePending: boolean;
  requiresSignIn: boolean;
  isHydrated: boolean;
  bootstrap: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useIdentityStore = create<IdentityState>((set) => ({
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
  isHydrated: false,

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

function updateStoreStateIfCurrent(
  generation: number,
  updates: Partial<Omit<IdentityState, 'bootstrap' | 'logout'>>,
): boolean {
  if (!isCurrentGeneration(lifecycle, generation)) return false;
  updateStoreState(updates);
  return true;
}

function legacyKeys() {
  return {
    guestId: SECURE_KEYS.GUEST_ID,
    guestCreatedAt: SECURE_KEYS.GUEST_CREATED_AT,
    accountId: SECURE_KEYS.ACCOUNT_ID,
    accountEmail: SECURE_KEYS.ACCOUNT_EMAIL,
    accountProvider: SECURE_KEYS.ACCOUNT_PROVIDER,
    refreshToken: SECURE_KEYS.REFRESH_TOKEN,
    requiresSignIn: SECURE_KEYS.REQUIRES_SIGN_IN,
  };
}

function principalState(envelope: SessionEnvelope) {
  const isAccount = envelope.kind === 'account' && !envelope.requiresSignIn;
  return {
    guestId: isAccount ? null : envelope.guestId,
    guestCreatedAt: isAccount ? null : envelope.guestCreatedAt,
    accountId: isAccount ? envelope.accountId : null,
    accountEmail: isAccount ? envelope.accountEmail : null,
    accountProvider: isAccount
      ? envelope.accountProvider ?? (envelope.accountEmail ? 'email' : null)
      : null,
    isAccount,
    requiresSignIn: envelope.requiresSignIn,
  };
}

async function readEnvelope(): Promise<SessionEnvelope> {
  return (await readSessionEnvelope(sessionStore, legacyKeys())) ?? emptySessionEnvelope();
}

async function writeEnvelope(envelope: SessionEnvelope): Promise<void> {
  await writeSessionEnvelope(sessionStore, envelope);
}

async function deleteLegacySessionKeys(): Promise<void> {
  await Promise.all(Object.values(legacyKeys()).map((key) => SecureStore.deleteItemAsync(key)));
}

/**
 * Bootstraps the guest identity. Collapses concurrent calls (single-flight).
 * Generates credentials if missing, attempts token refresh if refresh token exists,
 * or registers as a new/existing guest. Handles offline modes gracefully.
 */
export async function bootstrap(): Promise<void> {
  resetAccountDeletionTrigger();
  if (activeBootstrapPromise) {
    return activeBootstrapPromise;
  }

  const generation = captureGeneration(lifecycle);
  activeBootstrapPromise = (async () => {
    updateStoreState({ isPending: true });

    try {
      // Installation credentials remain separate from the session envelope.
      let installationKey = await SecureStore.getItemAsync(SECURE_KEYS.INSTALLATION_KEY);
      let credentialSecret = await SecureStore.getItemAsync(SECURE_KEYS.CREDENTIAL_SECRET);

      if (!installationKey || !credentialSecret) {
        installationKey = Crypto.randomUUID();
        const randomBytes = Crypto.getRandomBytes(32);
        credentialSecret = bufferToBase64Url(randomBytes);

        await SecureStore.setItemAsync(SECURE_KEYS.INSTALLATION_KEY, installationKey);
        await SecureStore.setItemAsync(SECURE_KEYS.CREDENTIAL_SECRET, credentialSecret);
      }

      const envelope = await readEnvelope();
      const principal = principalState(envelope);
      updateStoreStateIfCurrent(generation, {
        ...principal,
        isAuthenticated: false,
        isHydrated: true,
        isPending: true,
        isOfflinePending: false,
      });

      if (envelope.requiresSignIn) {
        return;
      }

      if (envelope.refreshToken) {
        try {
          await refreshSession();
          resetRetryDelay();
          return;
        } catch (err: unknown) {
          if (hasHttpStatus(err) && err.status === 401) {
            if (envelope.kind === 'account') return;
            await clearSessionStateOnly();
          } else {
            updateStoreStateIfCurrent(generation, { isPending: false, isOfflinePending: true });
            scheduleRetryBootstrap();
            throw err;
          }
        }
      }

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

          const createdAtVal = envelope.guestCreatedAt ?? nowStr;
          const nextEnvelope: SessionEnvelope = {
            ...emptySessionEnvelope(),
            kind: 'guest',
            guestId,
            guestCreatedAt: createdAtVal,
            refreshToken: newRefreshToken,
          };
          if (!isCurrentGeneration(lifecycle, generation)) return;
          const committedGeneration = advanceGeneration(lifecycle);
          await writeEnvelope(nextEnvelope);

          setAccessToken(accessToken);

          // Adopt the pre-identity database namespace for this guest (atomic file rename)
          await adoptPreIdentityDatabase(guestId);

          updateStoreStateIfCurrent(committedGeneration, {
            guestId,
            guestCreatedAt: createdAtVal,
            accountId: null,
            accountEmail: null,
            accountProvider: null,
            isAccount: false,
            isAuthenticated: true,
            isPending: false,
            isOfflinePending: false,
            isHydrated: true,
          });

          resetRetryDelay();
        } else if (response.status === 401) {
          // Credential rejected. Never purge or mint a new identity here — that
          // would silently orphan the player's server-side guest data. Guest
          // Data Reset is an explicit player action (issue #10). Surface a
          // pending state and let retries reuse the same stored credentials.
          console.warn('Backend rejected the stored guest credentials.');
          updateStoreStateIfCurrent(generation, {
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
        updateStoreStateIfCurrent(generation, {
          isPending: false,
          isOfflinePending: true,
        });
        scheduleRetryBootstrap();
        throw err;
      }
    } finally {
      updateStoreStateIfCurrent(generation, { isPending: false });
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

  const generation = captureGeneration(lifecycle);
  activeRefreshPromise = (async () => {
    const envelope = await readEnvelope();
    const refreshToken = envelope.refreshToken;
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const tokens = await performRefreshRequest(refreshToken);
      if (!isCurrentGeneration(lifecycle, generation)) {
        throw new Error('Stale identity refresh result');
      }
      const nextEnvelope = { ...envelope, refreshToken: tokens.refreshToken };
      await writeEnvelope(nextEnvelope);
      setAccessToken(tokens.accessToken);
      await openNamespace(envelope.kind === 'account' ? envelope.accountId : envelope.guestId);
      updateStoreStateIfCurrent(generation, {
        ...principalState(nextEnvelope),
        isAuthenticated: true,
        isHydrated: true,
        isOfflinePending: false,
      });

      return tokens.accessToken;
    } catch (err: unknown) {
      if (hasHttpStatus(err) && err.status === 401) {
        // Expired/rotated refresh token reuse detection: require account
        // reauthentication, while guests may bootstrap a fresh guest session.
        console.warn('Refresh token is invalid or reuse detected. Revoking and re-bootstrapping.');
        if (envelope.kind === 'account') {
          await requireAccountSignIn();
        } else {
          await clearSessionStateOnly();
          bootstrap().catch((bErr) => {
            console.error('Background guest bootstrap failed after refresh revocation:', bErr);
          });
        }
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
  const envelope = await readEnvelope();
  await writeEnvelope({ ...envelope, refreshToken: null });
  updateStoreState({
    isAuthenticated: false,
  });
}

async function requireAccountSignIn(): Promise<void> {
  advanceGeneration(lifecycle);
  setAccessToken(null);
  clearRefreshSchedule();
  const envelope = await readEnvelope();
  await writeEnvelope({ ...envelope, kind: 'account', refreshToken: null, requiresSignIn: true });
  updateStoreState({
    guestId: null,
    guestCreatedAt: null,
    accountId: null,
    accountEmail: null,
    accountProvider: null,
    isAccount: false,
    isAuthenticated: false,
    isPending: false,
    isOfflinePending: false,
    requiresSignIn: true,
    isHydrated: true,
  });
}

export async function handleAuthenticationRequired(): Promise<void> {
  if (useIdentityStore.getState().isAccount) {
    await requireAccountSignIn();
  }
}

/**
 * Logs out the current guest. Calls the backend logout endpoint, clears
 * tokens, guest identity metadata, and switches the database namespace to null (pre-identity).
 */
export async function logout(): Promise<void> {
  advanceGeneration(lifecycle);
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

  await clearSessionEnvelope(sessionStore);

  // Switch back to pre-identity database namespace
  await openNamespace(null);

  updateStoreState({
    guestId: null,
    guestCreatedAt: null,
    accountId: null,
    accountEmail: null,
    accountProvider: null,
    isAccount: false,
    isAuthenticated: false,
    isOfflinePending: false,
    requiresSignIn: false,
    isHydrated: true,
  });
}

export interface EmailAccountSession {
  accountId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export interface ReauthenticatedAccountSession {
  accessToken: string;
  accountId: string;
  refreshToken: string;
}

export interface AccountSession {
  accountId: string;
  accessToken: string;
  email: string | null;
  provider: AccountProvider;
  refreshToken: string;
}

/**
 * Adopts a verified Registered Account session (from email OTP verification).
 * Persists the rotating refresh token and account identity, arms the in-memory
 * access token with proactive refresh, opens the account's Local Identity
 * Namespace (keyed by accountId, so previously-signed-in local data reopens),
 * and flips the identity store to the account principal.
 */
export async function adoptEmailAccountSession(
  session: EmailAccountSession,
): Promise<void> {
  return adoptAccountSession({
    ...session,
    provider: 'email',
  });
}

/**
 * Adopts a verified Registered Account session from any accepted provider.
 * Firebase/provider tokens are not persisted; only the Game Backend session
 * and private display metadata live on the device.
 */
export async function adoptAccountSession(
  session: AccountSession,
): Promise<void> {
  advanceGeneration(lifecycle);
  resetAccountDeletionTrigger();
  clearRefreshSchedule();
  resetRetryDelay();

  await writeEnvelope({
    ...emptySessionEnvelope(),
    kind: 'account',
    accountId: session.accountId,
    accountEmail: session.email,
    accountProvider: session.provider,
    refreshToken: session.refreshToken,
  });
  await deleteLegacySessionKeys();

  setAccessToken(session.accessToken);

  await openNamespace(session.accountId);

  updateStoreState({
    guestId: null,
    guestCreatedAt: null,
    accountId: session.accountId,
    accountEmail: session.email,
    accountProvider: session.provider,
    isAccount: true,
    isAuthenticated: true,
    isPending: false,
    isOfflinePending: false,
    requiresSignIn: false,
    isHydrated: true,
  });
}

/**
 * Adopts a refreshed session for the account this device is already signed
 * into, as issued by deletion reauthentication.
 *
 * This is the client-side half of the same-account guarantee: a session for any
 * other account is refused outright rather than adopted. Because the principal
 * has not changed, the lifecycle generation, the displayed account, and the
 * Local Identity Namespace are all left exactly as they are — only the rotating
 * refresh token and the in-memory access token move forward.
 */
export async function adoptReauthenticatedSession(
  session: ReauthenticatedAccountSession,
): Promise<void> {
  const envelope = await readEnvelope();
  if (envelope.kind !== 'account' || envelope.accountId !== session.accountId) {
    throw new Error(
      'That sign-in belongs to a different account. Use a sign-in method linked to this account.',
    );
  }

  await writeEnvelope({ ...envelope, refreshToken: session.refreshToken });
  setAccessToken(session.accessToken);
  updateStoreState({
    isAuthenticated: true,
    isOfflinePending: false,
    requiresSignIn: false,
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

  if (response.status === 410) {
    try {
      const body = await response.clone().json();
      if (body && body.code === 'ACCOUNT_DELETED') {
        await handleAccountDeletedIdempotently();
      }
    } catch {
      // ignore
    }
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

/**
 * Destructively resets the guest data.
 * Order of execution (resilient):
 * 1) Call POST /v1/auth/guest/reset with the active session (must succeed first; online requirement).
 * 2) Delete the guest's namespace DB files (db + wal + shm) via expo-file-system.
 * 3) Purge ALL SecureStore identity keys (installation key, credential secret, guestId, createdAt, refresh token) and memory token.
 * 4) Run bootstrap() to generate a new installationKey/secret and get a fresh Guest Installation Identity with empty namespace.
 * 5) Reset in-memory stores (identity store, gameplay store) and TanStack Query cache.
 */
export async function resetGuestData(): Promise<void> {
  advanceGeneration(lifecycle);
  const response = await performAuthenticatedRequest(
    '/v1/auth/guest/reset',
    { method: 'POST' },
    { getAccessToken, refreshSession, onAccountDeleted: handleAccountDeletedIdempotently },
  );
  if (response.status !== 204) {
    throw new Error(`Failed to reset guest data on server: status ${response.status}`);
  }

  const guestId = useIdentityStore.getState().guestId;
  if (guestId) {
    await deleteNamespaceFiles(guestId);
  }

  setAccessToken(null);
  clearRefreshSchedule();
  resetRetryDelay();

  await SecureStore.deleteItemAsync(SECURE_KEYS.INSTALLATION_KEY);
  await SecureStore.deleteItemAsync(SECURE_KEYS.CREDENTIAL_SECRET);
  await clearSessionEnvelope(sessionStore);
  await deleteLegacySessionKeys();

  updateStoreState({
    guestId: null,
    guestCreatedAt: null,
    isAuthenticated: false,
    isPending: false,
    isOfflinePending: false,
    isHydrated: true,
  });

  await bootstrap();

  useGameplayStore.getState().resetGameplay();
  queryClient.clear();
}

/**
 * Removes local data only, leaving server state untouched.
 * Deletes the ACTIVE identity's namespace files only (guest namespace if identity exists, else pre-identity db).
 * Reinitializes an empty namespace and resets in-memory stores.
 * Works offline.
 */
export async function removeLocalData(): Promise<void> {
  const state = useIdentityStore.getState();
  const activeIdentity = state.accountId || state.guestId;
  await deleteNamespaceFiles(activeIdentity);
  await openNamespace(activeIdentity);
  useGameplayStore.getState().resetGameplay();
  queryClient.clear();
}

let isHandlingAccountDeletion = false;

export async function handleAccountDeletedIdempotently(): Promise<void> {
  if (isHandlingAccountDeletion) {
    return;
  }
  isHandlingAccountDeletion = true;
  try {
    await removeLocalData();
    await logout();
    await bootstrap();
  } catch (err) {
    console.error('Failed to handle account deletion:', err);
  } finally {
    isHandlingAccountDeletion = false;
  }
}
