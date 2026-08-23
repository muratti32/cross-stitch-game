import { apiFetch } from './apiFetch';
import { adoptReauthenticatedSession, type AccountProvider } from '../identity/guestIdentity';

export interface ReauthenticationIdentity {
  provider: AccountProvider;
  email: string | null;
}

export class AccountReauthenticationApiError extends Error {
  constructor(readonly status: number, readonly reason: string | null, message: string) {
    super(message);
    this.name = 'AccountReauthenticationApiError';
  }
}

interface ReauthenticationSession {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  provider: AccountProvider;
}

function isProvider(value: unknown): value is AccountProvider {
  return value === 'apple' || value === 'email' || value === 'google';
}

async function apiError(response: Response, fallback: string): Promise<AccountReauthenticationApiError> {
  let reason: string | null = null;
  let message = fallback;
  try {
    const body = (await response.json()) as { reason?: unknown; message?: unknown };
    if (typeof body.reason === 'string') reason = body.reason;
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // Keep the actionable fallback.
  }
  return new AccountReauthenticationApiError(response.status, reason, message);
}

function parseSession(value: unknown): ReauthenticationSession {
  if (typeof value !== 'object' || value === null) throw new Error('Reauthentication did not complete. Please retry.');
  const session = value as Partial<ReauthenticationSession>;
  if (typeof session.accessToken !== 'string' || typeof session.refreshToken !== 'string' || typeof session.accountId !== 'string' || !isProvider(session.provider)) {
    throw new Error('Reauthentication did not complete. Please retry.');
  }
  return session as ReauthenticationSession;
}

export async function getReauthenticationIdentities(): Promise<ReauthenticationIdentity[]> {
  const response = await apiFetch('/v1/account/reauthenticate/identities');
  if (!response.ok) throw await apiError(response, 'Could not load your linked sign-in methods. Check your connection and retry.');
  const body = (await response.json()) as { identities?: unknown };
  if (!Array.isArray(body.identities)) throw new Error('Your linked sign-in methods could not be read. Please retry.');
  return body.identities.map((value) => {
    if (typeof value !== 'object' || value === null) throw new Error('Your linked sign-in methods could not be read. Please retry.');
    const identity = value as { provider?: unknown; email?: unknown };
    if (!isProvider(identity.provider) || (identity.email !== null && typeof identity.email !== 'string')) throw new Error('Your linked sign-in methods could not be read. Please retry.');
    return { provider: identity.provider, email: identity.email };
  });
}

async function acceptSession(response: Response): Promise<void> {
  if (!response.ok) throw await apiError(response, 'Reauthentication failed. Please retry.');
  await adoptReauthenticatedSession(parseSession(await response.json()));
}

export async function reauthenticateWithFirebase(idToken: string): Promise<void> {
  const response = await apiFetch('/v1/account/reauthenticate/firebase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) });
  await acceptSession(response);
}

export async function requestReauthenticationEmailCode(email: string): Promise<void> {
  const response = await apiFetch('/v1/auth/email/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  if (response.status !== 202) throw await apiError(response, 'Could not send a verification code. Check your connection and retry.');
}

export async function reauthenticateWithEmail(email: string, code: string): Promise<void> {
  const response = await apiFetch('/v1/account/reauthenticate/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
  await acceptSession(response);
}
