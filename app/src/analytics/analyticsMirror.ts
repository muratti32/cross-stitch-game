import { Platform } from 'react-native';

import { Config } from '../config';
import { captureAnalyticsMirrorError } from '../observability/sentry';
import type { AnalyticsGameplayEventKind } from './schema';

/**
 * The Analytics Mirror (ADR-0055): a filtered, consent-gated copy of funnel
 * Gameplay Events and screen views sent to Firebase Analytics so funnel and
 * retention reports exist without querying the Game Backend by hand.
 *
 * The first-party Gameplay Event stream remains the single source of truth. The
 * mirror is deliberately lossy: only funnel endpoints travel, parameters are the
 * closed-enum payload fields the first-party schema already documents, and the
 * only identity sent is the opaque player reference (never an email address, a
 * Firebase UID, or an auth-provider subject).
 *
 * Every entry point here is fire-and-forget. A mirror failure must never block
 * play nor disturb the first-party enqueue that precedes it.
 */

/** Prefix keeping mirrored names clear of GA4 reserved/automatic event names. */
const MIRROR_EVENT_PREFIX = 'sw_';

/**
 * GA4's reserved purchase event, the one exception to the prefix rule: its
 * revenue reports only read this name.
 */
const GA4_PURCHASE_EVENT = 'purchase';

/**
 * The funnel endpoints that reach Firebase. Everything absent from this map -
 * tutorial beats, per-step onboarding views, most cancelled/failed variants,
 * catalog-incomplete, reconciliation-pending, subscription changes - stays
 * first-party only, where it remains fully queryable.
 */
const MIRRORED_EVENT_NAMES = {
  session_started: `${MIRROR_EVENT_PREFIX}session_started`,
  session_completed: `${MIRROR_EVENT_PREFIX}session_completed`,
  daily_task_completed: `${MIRROR_EVENT_PREFIX}daily_task_completed`,
  pattern_conversion_started: `${MIRROR_EVENT_PREFIX}pattern_conversion_started`,
  pattern_conversion_completed: `${MIRROR_EVENT_PREFIX}pattern_conversion_completed`,
  ai_generation_started: `${MIRROR_EVENT_PREFIX}ai_generation_started`,
  ai_generation_completed: `${MIRROR_EVENT_PREFIX}ai_generation_completed`,
  ai_generation_failed: `${MIRROR_EVENT_PREFIX}ai_generation_failed`,
  commerce_store_viewed: `${MIRROR_EVENT_PREFIX}commerce_store_viewed`,
  purchase_started: `${MIRROR_EVENT_PREFIX}purchase_started`,
  purchase_completed: GA4_PURCHASE_EVENT,
  onboarding_started: `${MIRROR_EVENT_PREFIX}onboarding_started`,
  onboarding_finished: `${MIRROR_EVENT_PREFIX}onboarding_finished`,
  account_soft_prompt_action: `${MIRROR_EVENT_PREFIX}account_soft_prompt_action`,
} as const satisfies Partial<Record<AnalyticsGameplayEventKind, string>>;

type MirroredKind = keyof typeof MIRRORED_EVENT_NAMES;

/**
 * Parameters that exist only for the mirror and are NEVER enqueued for the Game
 * Backend. Purchase amount lives here because the first-party purchase payload
 * is a closed shape the backend rejects unknown fields on, while GA4's revenue
 * reports need value and currency.
 */
export interface AnalyticsMirrorOnlyParams {
  readonly currency?: string;
  /** GA4 item rows; item_id carries the closed-enum product key, never free text. */
  readonly items?: readonly AnalyticsMirrorItem[];
  /**
   * The store transaction this purchase belongs to. GA4 de-duplicates purchases
   * on it, so a retry or a reconciliation reporting the same purchase again MUST
   * pass the same value rather than a freshly generated one.
   */
  readonly transactionId?: string;
  readonly value?: number;
}

export interface AnalyticsMirrorItem {
  readonly item_category: string;
  readonly item_id: string;
  readonly price?: number;
  readonly quantity: number;
}

export interface AnalyticsMirrorUserProperties {
  readonly is_guest: 'true' | 'false';
  readonly app_language: string;
  readonly membership_tier: string;
}

interface FirebaseAnalyticsSdk {
  getAnalytics(): unknown;
  /**
   * Synchronous since v26: the modular helper fires the native call and
   * discards its promise, so it hands back nothing to await or catch.
   */
  logEvent(analytics: unknown, name: string, params?: Record<string, unknown>): void;
  logScreenView(analytics: unknown, params: Record<string, unknown>): Promise<void>;
  setAnalyticsCollectionEnabled(analytics: unknown, enabled: boolean): Promise<void>;
  setUserId(analytics: unknown, id: string | null): Promise<void>;
  setUserProperty(analytics: unknown, name: string, value: string | null): Promise<void>;
}

/**
 * Bridge calls are `MirrorCall`s: some SDK helpers return a promise, `logEvent`
 * returns nothing. `run` normalizes both, so neither shape can reach a caller.
 */
type MirrorCall = Promise<unknown> | void;

interface AnalyticsBridge {
  logEvent(name: string, params?: Record<string, unknown>): void;
  logScreenView(params: Record<string, unknown>): Promise<void>;
  setAnalyticsCollectionEnabled(enabled: boolean): Promise<void>;
  setUserId(id: string | null): Promise<void>;
  setUserProperty(name: string, value: string | null): Promise<void>;
}

let bridge: AnalyticsBridge | null = null;
let bridgeResolved = false;
let consentGranted = false;
let errorReportedThisSession = false;
// Identity observed before consent was granted. The app learns who the player
// is at startup, long before the consent flow settles, so the reference and
// properties are held here and applied the moment collection is allowed -
// otherwise the first mirrored events would travel without a user id.
let pendingUserId: string | null = null;
let pendingUserIdKnown = false;
let pendingProperties: AnalyticsMirrorUserProperties | null = null;

/**
 * Resolves the native module lazily. A build without the Google service files
 * has no Firebase plugin at all (see app.config.ts), so requiring the module
 * eagerly would throw at import time on a perfectly valid checkout.
 */
function getBridge(): AnalyticsBridge | null {
  if (bridgeResolved) {
    return bridge;
  }
  bridgeResolved = true;

  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    bridge = null;
    return bridge;
  }

  try {
    // The SDK is modular-only: every call takes the Analytics instance. Adapting
    // it here keeps that shape out of the rest of the module. Required lazily so
    // a build with no Firebase plugin does not throw at import time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('@react-native-firebase/analytics') as FirebaseAnalyticsSdk;
    const instance = sdk.getAnalytics();
    bridge = {
      logEvent: (name, params) => sdk.logEvent(instance, name, params),
      logScreenView: (params) => sdk.logScreenView(instance, params),
      setAnalyticsCollectionEnabled: (enabled) =>
        sdk.setAnalyticsCollectionEnabled(instance, enabled),
      setUserId: (id) => sdk.setUserId(instance, id),
      setUserProperty: (name, value) => sdk.setUserProperty(instance, name, value),
    };
  } catch (error: unknown) {
    bridge = null;
    reportMirrorError('resolve-module', error);
  }
  return bridge;
}

/**
 * Collection is off unless the player has consented AND this build is allowed to
 * collect: a development build stays silent so local testing cannot distort
 * production reporting, unless EXPO_PUBLIC_FIREBASE_ANALYTICS_ENABLED opts that
 * device in for DebugView verification.
 */
function isCollectionAllowed(): boolean {
  if (!consentGranted) {
    return false;
  }
  return !__DEV__ || Config.firebaseAnalytics.enabledInDevelopment;
}

/**
 * Mirror failures are diagnosed through Sentry, but at most once per session:
 * an offline stretch or an initialization race would otherwise repeat the same
 * error for every event and burn the quota.
 */
function reportMirrorError(operation: string, error: unknown): void {
  if (errorReportedThisSession) {
    return;
  }
  errorReportedThisSession = true;
  captureAnalyticsMirrorError(operation, error);
}

/**
 * Attaches the rejection handler without assuming the call returned a promise:
 * `logEvent` returns nothing, and reading `.catch` off that would throw inside
 * the very path meant to keep mirror failures away from play.
 */
function guard(operation: string, result: MirrorCall): void {
  if (result === undefined) {
    return;
  }
  void Promise.resolve(result).catch((error: unknown) => reportMirrorError(operation, error));
}

function run(operation: string, call: (bridge: AnalyticsBridge) => MirrorCall): void {
  const resolved = getBridge();
  if (resolved === null || !isCollectionAllowed()) {
    return;
  }
  try {
    guard(operation, call(resolved));
  } catch (error: unknown) {
    reportMirrorError(operation, error);
  }
}

/** True when the native module is present, regardless of consent. */
export function isAnalyticsMirrorAvailable(): boolean {
  return getBridge() !== null;
}

/**
 * Applies the player's consent decision. Consent is owned by the existing UMP
 * flow (src/ads); the mirror keeps no consent state of its own beyond this flag,
 * and collection stays disabled until it is granted.
 */
export function applyAnalyticsMirrorConsent(granted: boolean): void {
  consentGranted = granted;
  const resolved = getBridge();
  if (resolved === null) {
    return;
  }
  const enabled = isCollectionAllowed();
  try {
    guard('set-collection-enabled', resolved.setAnalyticsCollectionEnabled(enabled));
  } catch (error: unknown) {
    reportMirrorError('set-collection-enabled', error);
  }

  if (enabled) {
    flushPendingIdentity();
  }
}

/**
 * Applies whatever identity was learned while collection was still disabled.
 * Called on the consent transition so events after it carry the opaque player
 * reference rather than starting anonymous until the next identity change.
 */
function flushPendingIdentity(): void {
  if (pendingUserIdKnown) {
    run('set-user-id', (resolved) => resolved.setUserId(pendingUserId));
  }
  if (pendingProperties !== null) {
    applyUserProperties(pendingProperties);
  }
}

function applyUserProperties(properties: AnalyticsMirrorUserProperties): void {
  for (const [name, value] of Object.entries(properties)) {
    run('set-user-property', (resolved) => resolved.setUserProperty(name, value));
  }
}

/**
 * Sets the opaque player reference - the same one Sentry receives - so a user
 * seen in the console can be found in the first-party stream. Never called with
 * an email address, Firebase UID, or provider subject (ADR-0038).
 */
export function setAnalyticsMirrorPlayerReference(opaqueId: string | null): void {
  pendingUserId = opaqueId;
  pendingUserIdKnown = true;
  run('set-user-id', (resolved) => resolved.setUserId(opaqueId));
}

export function setAnalyticsMirrorUserProperties(
  properties: AnalyticsMirrorUserProperties,
): void {
  pendingProperties = properties;
  applyUserProperties(properties);
}

function isMirroredKind(kind: AnalyticsGameplayEventKind): kind is MirroredKind {
  return kind in MIRRORED_EVENT_NAMES;
}

/**
 * Mirrors one Gameplay Event when it is on the allow-list. Payload fields travel
 * verbatim: the first-party schema admits only closed enums and booleans, so no
 * free text or player content can reach the vendor.
 */
export function mirrorGameplayEvent(
  kind: AnalyticsGameplayEventKind,
  payload: Record<string, unknown>,
  mirrorOnly?: AnalyticsMirrorOnlyParams,
): void {
  if (!isMirroredKind(kind)) {
    return;
  }
  const name = MIRRORED_EVENT_NAMES[kind];
  const params: Record<string, unknown> = { ...payload };
  if (mirrorOnly?.value !== undefined) {
    params.value = mirrorOnly.value;
  }
  if (mirrorOnly?.currency !== undefined) {
    params.currency = mirrorOnly.currency;
  }
  if (mirrorOnly?.transactionId !== undefined) {
    params.transaction_id = mirrorOnly.transactionId;
  }
  if (mirrorOnly?.items !== undefined) {
    params.items = mirrorOnly.items;
  }
  run('log-event', (resolved) => resolved.logEvent(name, params));
}

/**
 * Logs a screen view for a route TEMPLATE. Route parameters (Pattern ids and the
 * like) must never be passed here - they are per-player values with no place in
 * the mirror.
 */
export function mirrorScreenView(routeTemplate: string): void {
  run('log-screen-view', (resolved) =>
    resolved.logScreenView({ screen_class: routeTemplate, screen_name: routeTemplate }),
  );
}

/** Reset module-level state for testing purposes. */
export function __resetAnalyticsMirrorGlobals(): void {
  bridge = null;
  bridgeResolved = false;
  consentGranted = false;
  errorReportedThisSession = false;
  pendingUserId = null;
  pendingUserIdKnown = false;
  pendingProperties = null;
}
