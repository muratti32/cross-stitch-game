/**
 * #168's shared impure presentation helper for the Create surfaces (Photo
 * Import, AI Generation, the Pattern Editor): resolves a caught Pattern
 * Conversion or AI Artwork failure to localized player-facing text,
 * following the same "never render raw server text" rule as
 * localizeServerError.ts, which this delegates to first.
 *
 * Lives alongside conversion/api.ts (not inside a screen) because every
 * Create screen eventually routes through Pattern Conversion and needs the
 * same fallback chain; duplicating this per screen would drift.
 */
import i18n from '../i18n/i18n';
import { appendSupportReference, isServerApiError, localizeServerError } from '../api/localizeServerError';
import { ConversionTerminalFailureError, ConversionTimeoutError } from './api';

/**
 * @param fallbackKey i18next key used when `error` is neither a
 * server-reasoned API error nor a known Processing Job terminal state.
 * Defaults to the cross-cutting generic failure text from #159.
 */
export function resolveCreateErrorMessage(
  error: unknown,
  fallbackKey: string = 'errors:generic.failure',
): string {
  if (isServerApiError(error)) {
    return localizeServerError(error);
  }
  if (error instanceof ConversionTerminalFailureError) {
    return appendSupportReference(i18n.t('create:conversion.errors.failed'), error.supportReference);
  }
  if (error instanceof ConversionTimeoutError) {
    return appendSupportReference(i18n.t('create:conversion.errors.timeout'), error.supportReference);
  }
  return i18n.t(fallbackKey);
}
