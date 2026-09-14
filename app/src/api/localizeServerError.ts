/**
 * #159's thin, impure wrapper around the pure core in
 * serverErrorPresentation.ts: resolves a caught backend API error's
 * (reason, status) pair to localized player-facing text via i18next, and
 * reports the untouched raw server message to Sentry as diagnostic context
 * so localizing the player-facing text costs support nothing.
 *
 * `isServerApiError` duck-types on shape (`status: number`, `reason` in the
 * error) rather than importing every domain API module's error class by
 * name (AccountDeletionApiError, SocialApiError, CreatorProfileApiError,
 * AccountReauthenticationApiError all share this shape) - this module
 * would otherwise have to depend on every feature that has one.
 *
 * #249: every capture is explicitly fingerprinted (a code-shaped `reason`,
 * else the HTTP status) so Sentry groups by the actual failure instead of
 * by this module's own call stack, and a module-level cache mints exactly
 * one Support Reference per presented Error object so re-rendering the same
 * failure (a common pattern for render-path callers like
 * catalog.ts#presentCatalogError) never mints a second event or a second
 * reference for something the player already saw.
 */
import i18n from '../i18n/i18n';
import { presentServerError } from './serverErrorPresentation';

export interface ServerApiErrorLike {
  readonly status: number;
  readonly reason: string | null;
}

export function isServerApiError(error: unknown): error is Error & ServerApiErrorLike {
  return (
    error instanceof Error &&
    'reason' in error &&
    typeof (error as Partial<ServerApiErrorLike>).status === 'number'
  );
}

/** A `reason` short enough and shaped enough to be a stable grouping key. */
const CODE_SHAPED_REASON_PATTERN = /^[a-z0-9_]{1,64}$/;

/**
 * The Sentry fingerprint/grouping key for one error: its `reason` when that
 * looks like a machine code, else its HTTP status. Some endpoints put free
 * English prose in `reason` (see creatorProfile.ts) - that prose is never
 * used as a grouping key or an identifier, only the status is.
 */
function serverErrorKey(error: Error & ServerApiErrorLike): string {
  if (typeof error.reason === 'string' && CODE_SHAPED_REASON_PATTERN.test(error.reason)) {
    return error.reason;
  }
  return String(error.status);
}

/**
 * Caches only the minted Support Reference per presented Error object - not
 * the localized text, which must always be re-resolved through i18n.t so a
 * player who switches App Display Language while an error screen is still
 * showing sees it re-translate. Presenting the same Error object again
 * returns the same reference without capturing a new Sentry event.
 */
const supportReferenceByError = new WeakMap<Error, string>();

/**
 * Captures the handled failure as an informational Sentry event, explicitly
 * fingerprinted by `serverErrorKey` so unrelated failures never merge or
 * split by stack trace alone. Its event id becomes the opaque
 * player-visible Support Reference, while the raw backend prose remains
 * diagnostic context only.
 */
function captureServerErrorDiagnostics(error: Error & ServerApiErrorLike): string {
  // Required lazily, not statically, so call sites that reach this module
  // never pull in the real @sentry/react-native package for suites that
  // have no reason to mock it (see missingKeyHandler.ts for the same
  // convention).
  const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
  const key = serverErrorKey(error);
  let eventId = '';
  Sentry.withScope((scope) => {
    scope.setLevel('info');
    scope.setFingerprint(['server-error', key]);
    scope.setTag('server_error_status', String(error.status));
    scope.setTag('server_error_code', key);
    scope.setContext('server_error', {
      reason: error.reason,
      rawMessage: error.message,
      status: error.status,
    });
    eventId = Sentry.captureMessage(`Backend error presented: ${key}`);
  });
  return `SW-${eventId.toUpperCase()}`;
}

/**
 * Returns the one Support Reference for this Error object, minting and
 * caching it via `captureServerErrorDiagnostics` on first presentation and
 * returning the cached value (no new Sentry capture) on every later call.
 */
function supportReferenceFor(error: Error & ServerApiErrorLike): string {
  const cached = supportReferenceByError.get(error);
  if (cached !== undefined) {
    return cached;
  }
  const reference = captureServerErrorDiagnostics(error);
  supportReferenceByError.set(error, reference);
  return reference;
}

/**
 * Tracks which Error objects already left a known-reason breadcrumb, so a
 * render-path caller presenting the same Error object repeatedly (the same
 * concern #249 fixes for Sentry events) does not spam a fresh breadcrumb on
 * every render.
 */
const knownReasonBreadcrumbedErrors = new WeakSet<Error>();

/**
 * Leaves a breadcrumb (no Sentry event) for a recognized reason code, once
 * per Error object. Safe to send as-is: a recognized reason is a short
 * app-defined enum value, not raw backend prose.
 */
function addKnownReasonBreadcrumb(error: Error, reason: string): void {
  if (knownReasonBreadcrumbedErrors.has(error)) {
    return;
  }
  knownReasonBreadcrumbedErrors.add(error);
  const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
  Sentry.addBreadcrumb({
    category: 'server_error',
    level: 'info',
    data: { reason },
  });
}

/**
 * Appends a localized Support Reference line to a message, for any failure
 * (server-reasoned or purely client-side, such as a Processing Job's
 * terminal state) that carries one. Shared by localizeServerError below and
 * by presentation helpers for failures that never reach the server as an
 * HTTP error response, e.g. conversion/errorPresentation.ts.
 */
export function appendSupportReference(message: string, supportReference: string | undefined): string {
  if (supportReference === undefined) {
    return message;
  }
  const reference = i18n.t('errors:generic.supportReferenceLabel', {
    reference: supportReference,
  });
  return `${message}\n${reference}`;
}

/**
 * Resolves a caught backend API error to localized player-facing text. The
 * server's raw `message` is reported to Sentry as diagnostic context but is
 * never part of the returned string (#159's acceptance criteria).
 *
 * The known-vs-generic decision is made first, against `presentServerError`
 * with no Support Reference supplied, so a recognized reason (whose
 * presentation carries no `supportReference` key at all) never reaches
 * Sentry as an event (#249) - only a breadcrumb. Only the generic path goes
 * on to mint (or reuse) a Support Reference and re-resolve the presentation
 * with it attached.
 */
export function localizeServerError(error: Error & ServerApiErrorLike): string {
  const decision = presentServerError(error.reason, error.status);
  if (!('supportReference' in decision)) {
    if (typeof error.reason === 'string') {
      addKnownReasonBreadcrumb(error, error.reason);
    }
    return appendSupportReference(i18n.t(decision.messageKey), undefined);
  }
  const supportReference = supportReferenceFor(error);
  const presentation = presentServerError(error.reason, error.status, supportReference);
  return appendSupportReference(i18n.t(presentation.messageKey), presentation.supportReference);
}
