/**
 * Pure presentation logic mapping a backend error's machine-readable
 * `reason` code (plus its HTTP status) to a localized message key (#159,
 * parent #155). ADR-0051: the Game Backend is out of scope and its
 * `message` field is English prose, so the app stops rendering it to
 * players and maps `reason` instead.
 *
 * A `reason` this module does not recognize - including an absent one, and
 * including a `reason` that is itself free English prose rather than a
 * short code (the backend has been observed doing this for at least one
 * endpoint - see creatorProfile.ts) - resolves to the generic localized
 * failure plus a Support Reference (CONTEXT.md's term), built from the
 * status and reason so support can still correlate it with server logs
 * even though no backend-issued identifier backs it.
 *
 * No I/O here: the i18next lookup and the raw-message-to-Sentry reporting
 * live in localizeServerError.ts, the thin impure wrapper around this.
 */

/** Reason codes the app has chosen to give a specific localized message. */
export type KnownServerErrorReason = 'different_account' | 'provider_rejected';

const KNOWN_REASON_MESSAGE_KEYS: Record<KnownServerErrorReason, string> = {
  different_account: 'errors:reauthentication.differentAccount',
  provider_rejected: 'errors:reauthentication.providerRejected',
};

function isKnownServerErrorReason(reason: string): reason is KnownServerErrorReason {
  return Object.prototype.hasOwnProperty.call(KNOWN_REASON_MESSAGE_KEYS, reason);
}

export interface ServerErrorPresentation {
  /** i18next key, namespaced as `errors:...`, for the text to show the player. */
  readonly messageKey: string;
  /** Present only for the generic fallback; absent for a known, specific reason. */
  readonly supportReference?: string;
}

/**
 * A short opaque-looking code built client-side from the status and reason,
 * never from a backend-issued identifier (none of these reason-bearing
 * error responses carry one). Deterministic so the same failure always
 * reproduces the same reference for support to search logs by.
 */
function buildSupportReference(reason: string | null | undefined, status: number): string {
  const normalized =
    typeof reason === 'string' && reason.trim().length > 0
      ? reason
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 40)
      : '';
  return `ERR-${status}-${normalized.length > 0 ? normalized : 'UNKNOWN'}`;
}

/**
 * Maps a backend error's `reason` and HTTP `status` to what the player
 * sees. A recognized reason resolves to its specific localized message; a
 * null, absent, or unrecognized reason resolves to the generic localized
 * failure plus a Support Reference.
 */
export function presentServerError(
  reason: string | null | undefined,
  status: number,
): ServerErrorPresentation {
  if (typeof reason === 'string' && isKnownServerErrorReason(reason)) {
    return { messageKey: KNOWN_REASON_MESSAGE_KEYS[reason] };
  }
  return {
    messageKey: 'errors:generic.failure',
    supportReference: buildSupportReference(reason, status),
  };
}
