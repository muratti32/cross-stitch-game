/**
 * Single source of truth for telling a genuine connectivity failure apart
 * from a real backend failure. #152 (STITCH-WISH-P) and #153 (STITCH-WISH-N)
 * were the same offline condition reaching Sentry as two separate crash-class
 * events, purely because the platform message string differs between the two
 * codepaths iOS/RN can throw through fetch() when there is no connectivity.
 *
 * An HTTP error response (4xx/5xx) is a resolved `Response`, never a thrown
 * `Error` - it can never reach this classifier, so it is always treated as a
 * real backend failure.
 */
const OFFLINE_MESSAGE_FRAGMENTS = [
  // STITCH-WISH-P / #152 (iOS NSURLErrorNotConnectedToInternet) and
  // STITCH-WISH-N / #153 (iOS WebKit fetch shim). Both platform strings
  // embed this phrase, so one fragment covers both issues. Deliberately
  // NOT matching the bare prefix 'a network error has occurred': that
  // phrase alone does not prove connectivity loss, and this list also
  // gates the Sentry beforeSend drop, where an over-broad match would
  // silently suppress genuine backend failures.
  'internet connection appears to be offline',
  // React Native's own fetch polyfill, on both iOS and Android
  'network request failed',
];

/**
 * True when `error` is a thrown fetch failure caused by the device having no
 * network connectivity, rather than a genuine backend failure. Matching is
 * case-insensitive and substring-based so minor wording differences across
 * RN/iOS/Android versions still classify correctly.
 */
export function isOfflineNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return OFFLINE_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
}

/**
 * A typed, catchable stand-in for a raw fetch failure caused by the device
 * being offline. Callers (React Query, direct API callers) can use
 * `instanceof OfflineError` to show a "you're offline" state with retry,
 * instead of the generic "something went wrong" error path.
 */
export class OfflineError extends Error {
  readonly originalError: unknown;

  constructor(originalError: unknown) {
    super('Network request failed because the device appears to be offline.');
    this.name = 'OfflineError';
    this.originalError = originalError;
  }
}
