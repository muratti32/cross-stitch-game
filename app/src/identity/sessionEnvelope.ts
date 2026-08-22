export const SESSION_ENVELOPE_KEY = 'stitch_wish.session_envelope_v1';

export interface SessionEnvelope {
  version: 1;
  kind: 'guest' | 'account' | 'none';
  guestId: string | null;
  guestCreatedAt: string | null;
  accountId: string | null;
  accountEmail: string | null;
  accountProvider: 'apple' | 'email' | 'google' | null;
  refreshToken: string | null;
  requiresSignIn: boolean;
}

export interface SessionStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface LegacySessionKeys {
  guestId: string;
  guestCreatedAt: string;
  accountId: string;
  accountEmail: string;
  accountProvider: string;
  refreshToken: string;
  requiresSignIn: string;
}

export function emptySessionEnvelope(): SessionEnvelope {
  return {
    version: 1,
    kind: 'none',
    guestId: null,
    guestCreatedAt: null,
    accountId: null,
    accountEmail: null,
    accountProvider: null,
    refreshToken: null,
    requiresSignIn: false,
  };
}

function provider(value: string | null): SessionEnvelope['accountProvider'] {
  return value === 'apple' || value === 'email' || value === 'google' ? value : null;
}

function parse(value: string): SessionEnvelope | null {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Partial<SessionEnvelope>;
  if (candidate.version !== 1) return null;
  if (candidate.kind !== 'guest' && candidate.kind !== 'account' && candidate.kind !== 'none') return null;
  return {
    version: 1,
    kind: candidate.kind,
    guestId: typeof candidate.guestId === 'string' ? candidate.guestId : null,
    guestCreatedAt: typeof candidate.guestCreatedAt === 'string' ? candidate.guestCreatedAt : null,
    accountId: typeof candidate.accountId === 'string' ? candidate.accountId : null,
    accountEmail: typeof candidate.accountEmail === 'string' ? candidate.accountEmail : null,
    accountProvider: provider(typeof candidate.accountProvider === 'string' ? candidate.accountProvider : null),
    refreshToken: typeof candidate.refreshToken === 'string' ? candidate.refreshToken : null,
    requiresSignIn: candidate.requiresSignIn === true,
  };
}

export async function readSessionEnvelope(
  store: SessionStore,
  legacy: LegacySessionKeys,
): Promise<SessionEnvelope | null> {
  try {
    const serialized = await store.getItemAsync(SESSION_ENVELOPE_KEY);
    if (serialized !== null) return parse(serialized);

    const [guestId, guestCreatedAt, accountId, accountEmail, accountProvider, refreshToken, requires] =
      await Promise.all([
        store.getItemAsync(legacy.guestId),
        store.getItemAsync(legacy.guestCreatedAt),
        store.getItemAsync(legacy.accountId),
        store.getItemAsync(legacy.accountEmail),
        store.getItemAsync(legacy.accountProvider),
        store.getItemAsync(legacy.refreshToken),
        store.getItemAsync(legacy.requiresSignIn),
      ]);
    const envelope: SessionEnvelope = {
      version: 1,
      kind: accountId ? 'account' : guestId ? 'guest' : 'none',
      guestId,
      guestCreatedAt,
      accountId,
      accountEmail,
      accountProvider: provider(accountProvider),
      refreshToken,
      requiresSignIn: requires === 'true',
    };
    const hasLegacy = [guestId, guestCreatedAt, accountId, accountEmail, accountProvider, refreshToken, requires].some(
      (item) => item !== null,
    );
    if (hasLegacy) {
      await store.setItemAsync(SESSION_ENVELOPE_KEY, JSON.stringify(envelope));
      await Promise.all(Object.values(legacy).map((key) => store.deleteItemAsync(key)));
    }
    return envelope;
  } catch {
    return null;
  }
}

export async function writeSessionEnvelope(
  store: SessionStore,
  envelope: SessionEnvelope,
): Promise<boolean> {
  try {
    await store.setItemAsync(SESSION_ENVELOPE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

export async function clearSessionEnvelope(store: SessionStore): Promise<void> {
  try {
    await store.setItemAsync(SESSION_ENVELOPE_KEY, JSON.stringify(emptySessionEnvelope()));
  } catch {
    // Storage failure is handled as an absent session on the next bootstrap.
  }
}
