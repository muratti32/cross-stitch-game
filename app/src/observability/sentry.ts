import * as Sentry from '@sentry/react-native';
import { Config, isSentryConfigured } from '../config';
import { useIdentityStore } from '../identity/guestIdentity';

/**
 * ADR-0035: Sentry events are scrubbed before send. No prompt text, artwork,
 * Pattern bytes, email, or provider identifiers may leave the device. Player
 * references use the same opaque backend identifiers as a Support Reference
 * (CONTEXT.md), never an email address or auth-provider subject.
 *
 * This is a defense-in-depth net on top of not passing that data to Sentry in
 * the first place: any object attached to an event/breadcrumb (extra data,
 * contexts, breadcrumb payloads) has matching keys redacted before the event
 * ever leaves the device.
 */
const SCRUBBED_KEY_FRAGMENTS = [
  'email',
  'prompt',
  'artwork',
  'photo',
  'pattern', // patternBytes, patternData, personalPattern previews, etc.
  'idtoken',
  'accesstoken',
  'refreshtoken',
  'credentialsecret',
  'installationkey',
  'authorization',
  'cookie',
  'firebase',
  'apikey',
];

function isScrubbedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SCRUBBED_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

function scrub(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, seen));
  }

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    out[key] = isScrubbedKey(key) ? '[Scrubbed]' : scrub(source[key], seen);
  }
  return out;
}

function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  return {
    ...breadcrumb,
    message: breadcrumb.message,
    data: breadcrumb.data ? (scrub(breadcrumb.data) as Record<string, unknown>) : breadcrumb.data,
  };
}

let initialized = false;

/**
 * Initializes Sentry crash reporting and performance instrumentation.
 * Call once, as early as possible (module scope of the root layout), before
 * anything else that could throw. No-ops when no DSN is configured, so local
 * checkouts without the shared .env values keep working without Sentry.
 */
export function initSentry(): void {
  if (initialized || !isSentryConfigured()) {
    return;
  }
  initialized = true;

  Sentry.init({
    dsn: Config.sentry.dsn,
    environment: Config.sentry.environment,
    // Foundational sampling for the ADR-0031 performance release gate.
    // Custom stitch/undo latency spans are added where those interactions
    // are implemented; this only turns tracing on.
    tracesSampleRate: Config.sentry.environment === 'production' ? 0.2 : 1.0,
    enableAutoSessionTracking: true,
    // Never auto-attach device PII, screenshots, or view hierarchies -
    // screenshots/view hierarchies could capture in-progress artwork or
    // Pattern content.
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb);
    },
    beforeSend(event) {
      // Drop request data outright (can carry auth headers/cookies).
      event.request = undefined;

      // Only the opaque backend identifier may travel as `user`.
      if (event.user) {
        event.user = event.user.id ? { id: event.user.id } : undefined;
      }

      if (event.extra) {
        event.extra = scrub(event.extra) as typeof event.extra;
      }
      if (event.contexts) {
        event.contexts = scrub(event.contexts) as typeof event.contexts;
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
      }

      return event;
    },
  });
}

/**
 * Sets or clears the opaque player reference attached to future events - the
 * same Guest Installation Identity or Registered Account id used for a
 * Support Reference. Never pass an email address or provider subject here.
 */
export function setSentryPlayerReference(opaqueId: string | null): void {
  if (!isSentryConfigured()) {
    return;
  }
  Sentry.setUser(opaqueId ? { id: opaqueId } : null);
}

/**
 * Keeps the Sentry player reference in sync with the identity store, so
 * crashes/perf events can be correlated with a Support Reference without
 * wiring this into every call site that changes identity.
 */
export function syncSentryPlayerReferenceWithIdentity(): void {
  if (!isSentryConfigured()) {
    return;
  }

  const applyFromState = (state: { accountId: string | null; guestId: string | null }) => {
    setSentryPlayerReference(state.accountId ?? state.guestId);
  };

  applyFromState(useIdentityStore.getState());
  useIdentityStore.subscribe((state, prevState) => {
    if (state.accountId !== prevState.accountId || state.guestId !== prevState.guestId) {
      applyFromState(state);
    }
  });
}
