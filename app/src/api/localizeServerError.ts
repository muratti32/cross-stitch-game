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

/**
 * Captures the handled failure as an informational Sentry event. Its event
 * id becomes the opaque player-visible Support Reference, while the raw
 * backend prose remains diagnostic context only.
 */
function reportServerErrorDiagnostics(error: Error & ServerApiErrorLike): string {
  // Required lazily, not statically, so call sites that reach this module
  // never pull in the real @sentry/react-native package for suites that
  // have no reason to mock it (see missingKeyHandler.ts for the same
  // convention).
  const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
  let eventId = '';
  Sentry.withScope((scope) => {
    scope.setLevel('info');
    scope.setTag('server_error_status', String(error.status));
    scope.setContext('server_error', {
      reason: error.reason,
      rawMessage: error.message,
      status: error.status,
    });
    eventId = Sentry.captureMessage('Localized backend error presented to player');
  });
  return `SW-${eventId.toUpperCase()}`;
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
 */
export function localizeServerError(error: Error & ServerApiErrorLike): string {
  const supportReference = reportServerErrorDiagnostics(error);
  const presentation = presentServerError(error.reason, error.status, supportReference);
  return appendSupportReference(i18n.t(presentation.messageKey), presentation.supportReference);
}
