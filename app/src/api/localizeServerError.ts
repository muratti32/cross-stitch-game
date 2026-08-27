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
 * Reports the raw server message as a low-volume breadcrumb, not an error
 * event - this is an already-handled, expected failure path (same
 * convention as missingKeyHandler.ts's reportMissingTranslationKey), never
 * a crash.
 */
function reportServerErrorDiagnostics(error: Error & ServerApiErrorLike): void {
  // Required lazily, not statically, so call sites that reach this module
  // never pull in the real @sentry/react-native package for suites that
  // have no reason to mock it (see missingKeyHandler.ts for the same
  // convention).
  const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
  Sentry.addBreadcrumb({
    category: 'server-error',
    level: 'info',
    message: 'Localized a backend error for display',
    data: {
      status: error.status,
      reason: error.reason,
      rawMessage: error.message,
    },
  });
}

/**
 * Resolves a caught backend API error to localized player-facing text. The
 * server's raw `message` is reported to Sentry as diagnostic context but is
 * never part of the returned string (#159's acceptance criteria).
 */
export function localizeServerError(error: Error & ServerApiErrorLike): string {
  reportServerErrorDiagnostics(error);
  const presentation = presentServerError(error.reason, error.status);
  const message = i18n.t(presentation.messageKey);
  if (presentation.supportReference === undefined) {
    return message;
  }
  const reference = i18n.t('errors:generic.supportReferenceLabel', {
    reference: presentation.supportReference,
  });
  return `${message}\n${reference}`;
}
