/**
 * Email Sign-In (passwordless OTP) client.
 *
 * The backend owns code generation, the keyed verifier, expiry, attempt and
 * rate limits. This module only drives the two endpoints and, on success,
 * hands the issued session to the identity layer.
 *
 * These endpoints are pre-auth, so we use plain `fetch` rather than `apiFetch`:
 * apiFetch would intercept the verify 401 (wrong/expired code) as an access-token
 * failure and try to refresh+replay the *guest* session, masking the real result.
 */
import { Config } from '../config';
import { adoptEmailAccountSession } from './guestIdentity';

interface VerifyEmailOtpResponse {
  accountId: string;
  accessToken: string;
  refreshToken: string;
}

export type VerifyEmailOtpResult =
  | { kind: 'verified' }
  | { kind: 'rejected' };

function isVerifyResponse(value: unknown): value is VerifyEmailOtpResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as VerifyEmailOtpResponse).accountId === 'string' &&
    typeof (value as VerifyEmailOtpResponse).accessToken === 'string' &&
    typeof (value as VerifyEmailOtpResponse).refreshToken === 'string'
  );
}

/**
 * Requests a six-digit sign-in code for the address. The response is
 * intentionally opaque: it never reveals whether the address has an account,
 * and a rate-limited request is indistinguishable from an accepted one.
 * Resolves when the request was accepted (HTTP 202); rejects only on a
 * transport/server error so the UI can offer a retry.
 */
export async function requestEmailOtp(email: string): Promise<void> {
  const response = await fetch(`${Config.apiBaseUrl}/v1/auth/email/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  if (response.status !== 202) {
    throw new Error(
      `Failed to request sign-in code: server returned status ${response.status}`,
    );
  }
}

/**
 * Verifies the code. On success the Registered Account session is adopted
 * (tokens persisted, namespace opened, identity store flipped to account) and
 * `{ kind: 'verified' }` is returned. A wrong, expired, or already-used code
 * returns `{ kind: 'rejected' }`. Transport/server errors reject so the UI can
 * distinguish "try again later" from "that code is wrong".
 */
export async function verifyEmailOtp(
  email: string,
  code: string,
): Promise<VerifyEmailOtpResult> {
  const response = await fetch(`${Config.apiBaseUrl}/v1/auth/email/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });

  if (response.status === 401) {
    return { kind: 'rejected' };
  }

  if (response.status !== 200) {
    throw new Error(
      `Failed to verify sign-in code: server returned status ${response.status}`,
    );
  }

  const body: unknown = await response.json();
  if (!isVerifyResponse(body)) {
    throw new Error('Verify response was malformed');
  }

  await adoptEmailAccountSession({
    accountId: body.accountId,
    email,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  });

  return { kind: 'verified' };
}
