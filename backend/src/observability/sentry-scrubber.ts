/**
 * Local self-contained type definitions for Sentry events and breadcrumbs.
 * This guarantees zero external module dependency overhead during TypeORM
 * database migrations, CLI scripts, and standalone test runs.
 */
export interface Breadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
  type?: string;
  level?: any;
  event_id?: string;
  timestamp?: number;
}

export interface ExceptionValue {
  type?: string;
  value?: string;
  mechanism?: unknown;
  stacktrace?: unknown;
}

export interface SentryEvent {
  type?: string;
  request?: unknown;
  user?: { id?: string | number; [key: string]: unknown };
  extra?: Record<string, unknown> | unknown;
  contexts?: Record<string, unknown> | unknown;
  tags?: Record<string, unknown> | unknown;
  breadcrumbs?: Breadcrumb[];
  exception?: {
    values?: ExceptionValue[];
  };
  message?: string;
}

/**
 * ADR-0035: Sentry events are scrubbed before send. No prompt text, artwork,
 * Pattern bytes, email, OTP, or provider identifiers may leave the backend.
 * Player references use the same opaque backend identifiers as a Support
 * Reference (CONTEXT.md), never an email address or auth-provider subject.
 *
 * This is a defense-in-depth net on top of not passing that data to Sentry in
 * the first place: any object attached to an event/breadcrumb (extra data,
 * contexts, tags, breadcrumb payloads) has matching keys redacted before the
 * event ever leaves the process.
 */
const SCRUBBED_KEY_FRAGMENTS = [
  'email',
  'prompt',
  'artwork',
  'photo',
  'pattern', // patternBytes, patternData, personalPattern previews, etc.
  'otp',
  'code',
  'token',
  'secret',
  'key',
  'signature',
  'authorization',
  'cookie',
  'firebase',
  'revenuecat',
  'fal',
  'admob',
  'provider',
];

/**
 * Keys that match a scrubbed fragment but carry no player data - protocol and
 * domain codes that are the whole point of having the event. `code` has to stay
 * in the deny list because that is what the email one-time passcode is called,
 * so the harmless codes are named here instead.
 */
const SCRUBBED_KEY_EXCEPTIONS = new Set([
  'statuscode',
  'errorcode',
  'httpstatuscode',
  'exitcode',
  'sqlstate',
]);

const SCRUBBED_VALUE = '[Scrubbed]';
const OPAQUE_BACKEND_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Free text (an exception message, a captureMessage title) keeps its shape so a
 * crash or an operational alert is still diagnosable, but anything shaped like
 * an email address, a bearer token, a JWT, or a long opaque secret is redacted
 * out of it, and the text is capped so a prompt or a serialized payload cannot
 * ride along in a message.
 */
const MAX_TEXT_LENGTH = 512;
const TEXT_REDACTIONS: readonly RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.-]+/gi,
  /\bBearer\s+[\w\-._~+/]+=*/gi,
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g,
  /\b[A-Za-z0-9_-]{40,}\b/g,
];

function redactText(text: string): string {
  let redacted = text;
  for (const pattern of TEXT_REDACTIONS) {
    redacted = redacted.replace(pattern, SCRUBBED_VALUE);
  }
  return redacted.length > MAX_TEXT_LENGTH
    ? `${redacted.slice(0, MAX_TEXT_LENGTH)}…[Truncated]`
    : redacted;
}

function isScrubbedKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SCRUBBED_KEY_EXCEPTIONS.has(lower)) {
    return false;
  }
  return SCRUBBED_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

function scrub(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `[Scrubbed:${value.length}-bytes]`;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, seen));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    out[key] = isScrubbedKey(key) ? SCRUBBED_VALUE : scrub(source[key], seen);
  }
  return out;
}

/**
 * Applies the ADR-0035 recursive key and text scrubbing policy to data that
 * stays in the Game Backend. Webhook retention uses this before persistence;
 * it deliberately shares the Sentry policy instead of letting a second
 * privacy deny-list drift from it.
 */
export function scrubWebhookPayload(value: unknown): unknown {
  return scrub(value);
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const isHttpBreadcrumb =
    breadcrumb.category === 'http' ||
    breadcrumb.category === 'fetch' ||
    breadcrumb.category === 'xhr';
  if (isHttpBreadcrumb) {
    return {
      ...breadcrumb,
      data: undefined,
      message: undefined,
    };
  }

  return {
    ...breadcrumb,
    message:
      breadcrumb.message === undefined
        ? breadcrumb.message
        : redactText(breadcrumb.message),
    data: breadcrumb.data
      ? (scrub(breadcrumb.data) as Record<string, unknown>)
      : breadcrumb.data,
  };
}

function scrubEvent<T extends SentryEvent>(event: T): T {
  // Request bodies, headers, cookies, and query strings can contain auth
  // credentials and OTP values. Do not send any request data at all.
  event.request = undefined;

  // Only the opaque backend identifier may travel as `user`.
  if (event.user !== undefined) {
    event.user =
      typeof event.user.id === 'string' &&
      OPAQUE_BACKEND_ID_PATTERN.test(event.user.id)
        ? { id: event.user.id }
        : undefined;
  }

  if (event.extra !== undefined) {
    event.extra = scrub(event.extra) as typeof event.extra;
  }
  if (event.contexts !== undefined) {
    event.contexts = scrub(event.contexts) as typeof event.contexts;
  }
  if (event.tags !== undefined) {
    event.tags = scrub(event.tags) as typeof event.tags;
  }
  if (event.breadcrumbs !== undefined) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  }

  // Error messages and captureMessage titles can quote upstream provider
  // details. Redact the sensitive shapes out of the text instead of wiping it -
  // an event with no message is not diagnosable, and operational alerts
  // (issue #63) carry their meaning in the message.
  if (event.exception?.values !== undefined) {
    event.exception.values = event.exception.values.map((value: ExceptionValue) => ({
      ...value,
      value: value.value === undefined ? value.value : redactText(value.value),
    }));
  }
  if (typeof event.message === 'string') {
    event.message = redactText(event.message);
  }

  return event;
}

export function scrubSentryEvent<T extends SentryEvent>(event: T): T {
  return scrubEvent(event);
}

export function scrubSentryTransaction<T extends SentryEvent>(event: T): T {
  return scrubEvent(event);
}

export { scrubBreadcrumb };
