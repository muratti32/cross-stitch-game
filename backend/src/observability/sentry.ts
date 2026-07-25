import {
  readSentryBootstrapEnvironment,
  type SentryEnvironmentVariables,
} from '../config';
import { scrubBreadcrumb, scrubSentryEvent, scrubSentryTransaction } from './sentry-scrubber';

export interface SentryScope {
  setTag(key: string, value: string): void;
  setLevel(level: string): void;
  setFingerprint(fingerprint: string[]): void;
  setContext(name: string, context: Record<string, unknown>): void;
}

export interface NodeOptions {
  dsn?: string;
  environment?: string;
  release?: string;
  tracesSampleRate?: number;
  sendDefaultPii?: boolean;
  beforeBreadcrumb?: (breadcrumb: any) => any;
  beforeSend?: (event: any) => any;
  beforeSendTransaction?: (event: any) => any;
}

interface SentrySdk {
  init(options: NodeOptions): unknown;
  withScope?(callback: (scope: SentryScope) => void): void;
  captureException?(error: unknown): void;
  captureMessage?(message: string): void;
}

function loadSentrySdk(): SentrySdk | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@sentry/nestjs') as SentrySdk;
  } catch {
    return null;
  }
}

const Sentry = loadSentrySdk();

export function initializeSentry(
  config: SentryEnvironmentVariables,
  sdk: SentrySdk | null,
): boolean {
  if (config.SENTRY_DSN === undefined || !sdk) {
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
  if (!isSentryEnabled || !Sentry?.withScope) {
    return;
  }
  Sentry.withScope((scope: SentryScope) => {
    scope.setTag('job.kind', jobKind);
    Sentry.captureException?.(error);
  });
}

export function captureBootstrapFailure(
  error: unknown,
  entrypoint: 'api' | 'worker',
): void {
  if (!isSentryEnabled || !Sentry?.withScope) {
    return;
  }
  Sentry.withScope((scope: SentryScope) => {
    scope.setTag('entrypoint', entrypoint);
    Sentry.captureException?.(error);
  });
}

/**
 * Raises an operational alert (issue #63: queue depth, webhook failures,
 * stuck Processing Jobs, Promotion Needs Attention) through the same #59
 * Sentry pipeline crashes use, rather than a second reporting channel. The
 * fingerprint groups repeat breaches of the same signal into one Sentry
 * issue instead of a new one per evaluation tick. Callers are expected to
 * have already scrubbed `context` (see OperationalAlertsService); `beforeSend`
 * (sentry-scrubber.ts) still re-scrubs it as the defense-in-depth net ADR-0035
 * describes before the event leaves the process.
 */
export function captureOperationalAlert(
  message: string,
  level: 'warning' | 'error',
  fingerprint: string,
  context: Record<string, unknown>,
): void {
  if (!isSentryEnabled || !Sentry?.withScope) {
    return;
  }
  Sentry.withScope((scope: SentryScope) => {
    scope.setLevel(level);
    scope.setFingerprint([fingerprint]);
    scope.setContext('operational_alert', context);
    Sentry.captureMessage?.(message);
  });
}
