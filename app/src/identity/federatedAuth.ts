import { Config } from '../config';
import {
  adoptAccountSession,
  type AccountProvider,
} from './guestIdentity';

interface FirebaseExchangeResponse {
  accessToken: string;
  accountId: string;
  email: string | null;
  provider: Extract<AccountProvider, 'apple' | 'google'>;
  refreshToken: string;
}

function isFirebaseExchangeResponse(
  value: unknown,
): value is FirebaseExchangeResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as FirebaseExchangeResponse;
  return (
    typeof candidate.accessToken === 'string' &&
    typeof candidate.accountId === 'string' &&
    (candidate.email === null || typeof candidate.email === 'string') &&
    (candidate.provider === 'apple' || candidate.provider === 'google') &&
    typeof candidate.refreshToken === 'string'
  );
}

export async function exchangeFirebaseIdToken(idToken: string): Promise<void> {
  const response = await fetch(
    `${Config.apiBaseUrl}/v1/auth/firebase/exchange`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  );

  if (response.status !== 200) {
    throw new Error(
      `Social sign-in failed: server returned status ${response.status}`,
    );
  }

  const body: unknown = await response.json();
  if (!isFirebaseExchangeResponse(body)) {
    throw new Error('Social sign-in response was malformed');
  }

  await adoptAccountSession({
    accountId: body.accountId,
    accessToken: body.accessToken,
    email: body.email,
    provider: body.provider,
    refreshToken: body.refreshToken,
  });
}
