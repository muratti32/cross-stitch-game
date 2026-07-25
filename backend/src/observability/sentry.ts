import * as Sentry from '@sentry/nestjs';
import type { NodeOptions } from '@sentry/node';

import {
  readSentryBootstrapEnvironment,
  type SentryEnvironmentVariables,
} from '../config';
import { scrubBreadcrumb, scrubSentryEvent, scrubSentryTransaction } from './sentry-scrubber';

interface SentrySdk {
  init(options: NodeOptions): unknown;
}

export function initializeSentry(
  config: SentryEnvironmentVariables,
  sdk: SentrySdk,
): boolean {
  if (config.SENTRY_DSN === undefined) {
    return false;
  }

  sdk.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT,
    release: config.SENTRY_RELEASE,
    tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubSentryEvent,
    beforeSendTransaction: scrubSentryTransaction,
  });
  return true;
}

/**
 * Initializes Sentry before Nest imports application modules so the SDK can
 * instrument the API and worker. No-ops without a DSN, preserving local
 * checkouts and test runs that do not configure Sentry.
 */
export const isSentryEnabled = initializeSentry(
  readSentryBootstrapEnvironment(),
  Sentry,
);

export function captureWorkerFailure(error: unknown, jobKind: string): void {
  if (!isSentryEnabled) {
    return;
  }
  Sentry.withScope((scope) => {
    scope.setTag('job.kind', jobKind);
    Sentry.captureException(error);
  });
}

export function captureBootstrapFailure(
  error: unknown,
  entrypoint: 'api' | 'worker',
): void {
  if (!isSentryEnabled) {
    return;
  }
  Sentry.withScope((scope) => {
    scope.setTag('entrypoint', entrypoint);
    Sentry.captureException(error);
  });
}
