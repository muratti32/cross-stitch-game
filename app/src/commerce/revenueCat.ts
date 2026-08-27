import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  LOG_LEVEL,
  PURCHASES_ERROR_CODE,
  type MakePurchaseResult,
  type PurchasesError,
  type PurchasesOfferings,
  type PurchasesPackage,
} from 'react-native-purchases';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

export type RevenueCatStoreMode = 'native' | 'test_store';
export type RevenueCatRuntimeStatus = 'disabled' | 'connecting' | 'ready' | 'error';

export const CANONICAL_REVENUECAT_PRODUCT_IDS = [
  'com.avk.stitchwish.premium_weekly',
  'com.avk.stitchwish.premium_monthly',
  'com.avk.stitchwish.premium_annual',
  'com.avk.stitchwish.coin_pack_300',
  'com.avk.stitchwish.coin_pack_900',
  'com.avk.stitchwish.coin_pack_2000',
  'com.avk.stitchwish.ai_credit_pack_5',
  'com.avk.stitchwish.ai_credit_pack_20',
  'com.avk.stitchwish.ai_credit_pack_50',
] as const;

interface RevenueCatRuntimeState {
  status: RevenueCatRuntimeStatus;
  storeMode: RevenueCatStoreMode | null;
  associatedAccountId: string | null;
  message: string | null;
  /**
   * True only alongside `status: 'error'`. RevenueCat never confirms an
   * absence of entitlement through this module - Premium Membership is
   * server-authoritative via the Game Backend's Membership API (ADR-0032 /
   * ADR-0043) and is never derived from RevenueCat client state - so `error`
   * always means "could not be resolved" and must never be read by callers
   * as "confirmed not entitled".
   */
  initializeUnresolved: boolean;
}

interface RevenueCatPublicConfiguration {
  storeMode: RevenueCatStoreMode;
  apiKey: string;
}

interface RevenueCatEnvironment {
  storeMode: string | undefined;
  testStoreApiKey: string | undefined;
  iosApiKey: string | undefined;
  androidApiKey: string | undefined;
}

const INITIAL_STATE: RevenueCatRuntimeState = {
  status: 'connecting',
  storeMode: null,
  associatedAccountId: null,
  message: null,
  initializeUnresolved: false,
};

export const useRevenueCatRuntime = create<RevenueCatRuntimeState>(() => INITIAL_STATE);

let configured = false;
let initializationPromise: Promise<boolean> | null = null;
let identityQueue: Promise<void> = Promise.resolve();

// Bounded backoff for RevenueCat's `PURCHASES_ERROR_CODE.UNKNOWN_BACKEND_ERROR`
// ("16"): a transient backend-side validation failure, not a verdict on
// entitlement. Issue #151 observed this as the backend error code 7934
// ("Rejecting receipt.") carried in the error's message/userInfo - 7934 is
// never the value of `error.code`, only `UNKNOWN_BACKEND_ERROR` is. Three
// retries clears most one-off blips without retrying forever; anything else -
// bad config, unsupported platform, a genuine SDK exception - fails
// immediately, as before.
const BACKEND_ERROR_RETRY_DELAYS_MS = [2_000, 5_000, 15_000] as const;

function isPurchasesError(error: unknown): error is PurchasesError {
  return (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof (error as { code: unknown }).code === 'string'
  );
}

function isRetryableInitializeError(error: unknown): boolean {
  return isPurchasesError(error) && error.code === PURCHASES_ERROR_CODE.UNKNOWN_BACKEND_ERROR;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type BoundedRetryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown; readonly abandonedInBackground: boolean };

/**
 * Runs `operation`, retrying with bounded backoff only when it fails with
 * RevenueCat's `UnknownBackendError`. This never waits indefinitely: each
 * backoff delay is a plain timer, and if the app is backgrounded once that
 * delay elapses, the retry loop is abandoned immediately rather than parked
 * waiting for the app to return to the foreground - the observed event in
 * issue #151 fired with `in_foreground: false`, and a retry loop that blocks
 * on foreground indefinitely would leave the caller's promise unsettled for
 * as long as the app stays backgrounded, which is unbounded in wall-clock
 * time even though the attempt count is capped. Exhausting the retry budget,
 * a non-retryable error, or an abandon-in-background all resolve with
 * `ok: false` so the caller can settle deterministically either way.
 */
async function withBoundedBackendRetry<T>(
  operation: () => Promise<T>,
  onRetryableFailure?: (attempt: number, error: unknown) => void,
): Promise<BoundedRetryResult<T>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return { ok: true, value: await operation() };
    } catch (error: unknown) {
      const hasRetryBudget = isRetryableInitializeError(error) && attempt < BACKEND_ERROR_RETRY_DELAYS_MS.length;
      if (!hasRetryBudget) return { ok: false, error, abandonedInBackground: false };

      onRetryableFailure?.(attempt, error);
      await delay(BACKEND_ERROR_RETRY_DELAYS_MS[attempt]);
      if (AppState.currentState !== 'active') return { ok: false, error, abandonedInBackground: true };
    }
  }
}

// Exactly one foreground-resume can be pending at a time; scheduling a new one
// replaces (and removes) any earlier subscription instead of stacking
// listeners.
let pendingForegroundResume: { remove: () => void } | null = null;

/**
 * Resumes identity synchronization automatically the next time the app
 * becomes active, after a retry was abandoned mid-backoff because the app was
 * backgrounded. This runs outside the queued transition its caller already
 * settled, so it can never block a later `synchronizeRevenueCatIdentity` call
 * - it only starts a new one once the app is foregrounded again.
 */
function scheduleForegroundResume(accountId: string | null): void {
  pendingForegroundResume?.remove();
  const subscription = AppState.addEventListener('change', (nextState) => {
    if (nextState !== 'active') return;
    subscription.remove();
    if (pendingForegroundResume === subscription) pendingForegroundResume = null;
    synchronizeRevenueCatIdentity(accountId).catch((error: unknown) => {
      console.warn(
        'RevenueCat identity synchronization deferred:',
        error instanceof Error ? error.message : String(error),
      );
    });
  });
  pendingForegroundResume = subscription;
}

export function resolveRevenueCatConfiguration(
  environment: RevenueCatEnvironment,
  platform: string,
): RevenueCatPublicConfiguration | { message: string } {
  if (environment.storeMode !== 'native' && environment.storeMode !== 'test_store') {
    return {
      message:
        'Commerce is unavailable because EXPO_PUBLIC_REVENUECAT_STORE_MODE must be native or test_store.',
    };
  }

  if (platform !== 'ios' && platform !== 'android') {
    return { message: 'Commerce is available only in the iOS and Android apps.' };
  }

  const apiKey = environment.storeMode === 'test_store'
    ? environment.testStoreApiKey
    : platform === 'ios'
      ? environment.iosApiKey
      : environment.androidApiKey;

  if (!apiKey) {
    const keyName = environment.storeMode === 'test_store'
      ? 'EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY'
      : platform === 'ios'
        ? 'EXPO_PUBLIC_REVENUECAT_API_KEY_IOS'
        : 'EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID';
    return { message: `Commerce is unavailable because ${keyName} is not configured.` };
  }

  const expectedPrefix = environment.storeMode === 'test_store'
    ? 'test_'
    : platform === 'ios'
      ? 'appl_'
      : 'goog_';
  if (!apiKey.startsWith(expectedPrefix)) {
    return {
      message:
        `Commerce is unavailable because the configured ${environment.storeMode} RevenueCat key is invalid for ${platform}.`,
    };
  }

  return { storeMode: environment.storeMode, apiKey };
}

export async function initializeRevenueCat(): Promise<boolean> {
  if (configured) return true;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    const configuration = resolveRevenueCatConfiguration(
      {
        storeMode: process.env.EXPO_PUBLIC_REVENUECAT_STORE_MODE,
        testStoreApiKey: process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY,
        iosApiKey: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS,
        androidApiKey: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID,
      },
      Platform.OS,
    );

    if ('message' in configuration) {
      useRevenueCatRuntime.setState({
        ...INITIAL_STATE,
        status: 'disabled',
        message: configuration.message,
      });
      return false;
    }

    useRevenueCatRuntime.setState({
      ...INITIAL_STATE,
      status: 'connecting',
      storeMode: configuration.storeMode,
    });

    try {
      if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
      // Deliberately omit appUserID. RevenueCat creates its own anonymous ID,
      // which is allowed to browse the catalog but is never a Guest Installation
      // Identity from the Game Backend (ADR-0032).
      Purchases.configure({ apiKey: configuration.apiKey });
      if (Platform.OS === 'ios') {
        // RevenueCat collects the AdServices token and resolves Apple Search Ads
        // campaign/ad-group/keyword attribution in the background. This is a
        // best-effort analytics integration and must never make commerce
        // unavailable when an older OS or native SDK has a transient failure.
        try {
          await Purchases.enableAdServicesAttributionTokenCollection();
        } catch (error: unknown) {
          console.warn(
            'Apple Search Ads attribution collection deferred:',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      configured = true;
      useRevenueCatRuntime.setState({
        status: 'ready',
        storeMode: configuration.storeMode,
        associatedAccountId: null,
        message: null,
        initializeUnresolved: false,
      });
      return true;
    } catch (error: unknown) {
      useRevenueCatRuntime.setState({
        status: 'error',
        storeMode: configuration.storeMode,
        associatedAccountId: null,
        message: revenueCatErrorMessage(error, 'RevenueCat could not be initialized.'),
        initializeUnresolved: true,
      });
      return false;
    }
  })().finally(() => {
    initializationPromise = null;
  });

  return initializationPromise;
}

/**
 * Serializes identity transitions through RevenueCat. Every queued request
 * re-reads the SDK identity, so repeated bootstrap/login/logout calls are safe
 * and only a real identity change invokes logIn or logOut.
 */
export function synchronizeRevenueCatIdentity(accountId: string | null): Promise<void> {
  const transition = identityQueue
    .catch(() => undefined)
    .then(async () => {
      if (!(await initializeRevenueCat())) return;
      await resolveRevenueCatIdentity(accountId);
    });

  identityQueue = transition;
  return transition;
}

/**
 * Resolves RevenueCat identity for `accountId`, retrying a bounded number of
 * times when the backend rejects the request with `UnknownBackendError`. This
 * always settles in bounded wall-clock time: exhausting the retry budget, a
 * non-retryable error, or the app being backgrounded when a retry comes due
 * all settle to `status: 'error'` immediately - the identity could not be
 * confirmed, which is never the same as confirming the account holds no
 * entitlement, and the existing Store screen's Retry affordance is what
 * surfaces this to the player rather than an indefinite "connecting" spinner.
 * A background-abandoned attempt additionally schedules an automatic resume
 * for the next time the app returns to the foreground.
 */
async function resolveRevenueCatIdentity(accountId: string | null): Promise<void> {
  const result = await withBoundedBackendRetry(
    () => resolveRevenueCatIdentityOnce(accountId),
    () => {
      useRevenueCatRuntime.setState({
        status: 'connecting',
        message: 'Reconnecting to the App Store to confirm your account…',
      });
    },
  );

  if (result.ok) return;

  useRevenueCatRuntime.setState({
    status: 'error',
    associatedAccountId: null,
    message: revenueCatErrorMessage(result.error, 'RevenueCat identity could not be synchronized.'),
    initializeUnresolved: true,
  });

  if (result.abandonedInBackground) scheduleForegroundResume(accountId);

  throw result.error;
}

async function resolveRevenueCatIdentityOnce(accountId: string | null): Promise<void> {
  const currentUserId = await Purchases.getAppUserID();
  const isAnonymous = await Purchases.isAnonymous();

  if (accountId === null) {
    if (!isAnonymous) await Purchases.logOut();
    useRevenueCatRuntime.setState({
      status: 'ready',
      associatedAccountId: null,
      message: null,
      initializeUnresolved: false,
    });
    return;
  }

  if (isAnonymous || currentUserId !== accountId) {
    await Purchases.logIn(accountId);
  }
  useRevenueCatRuntime.setState({
    status: 'ready',
    associatedAccountId: accountId,
    message: null,
    initializeUnresolved: false,
  });
}

export async function getRevenueCatOfferings(): Promise<PurchasesOfferings> {
  if (!(await initializeRevenueCat())) {
    throw new Error(useRevenueCatRuntime.getState().message ?? 'Commerce is not configured.');
  }
  return Purchases.getOfferings();
}

export function missingCanonicalRevenueCatProducts(
  offerings: Pick<PurchasesOfferings, 'current'>,
): string[] {
  const availableProductIds = new Set(
    (offerings.current?.availablePackages ?? []).flatMap((pkg) => [
      pkg.identifier,
      pkg.product.identifier,
    ]).map(storeProductKey),
  );

  return CANONICAL_REVENUECAT_PRODUCT_IDS.filter(
    (productId) => !availableProductIds.has(productId),
  );
}

export async function purchaseRevenueCatPackage(
  pkg: PurchasesPackage,
  accountId: string | null,
  allowAnonymous = false,
): Promise<MakePurchaseResult> {
  if (!accountId && !allowAnonymous) {
    throw new Error('Sign in with a Registered Account before purchasing.');
  }
  await synchronizeRevenueCatIdentity(accountId);
  if (!allowAnonymous && useRevenueCatRuntime.getState().associatedAccountId !== accountId) {
    throw new Error('Commerce could not verify the signed-in account. Try signing in again.');
  }
  return Purchases.purchasePackage(pkg);
}

/**
 * Guest commerce keys the Game Backend mapping on the RevenueCat subscriber, so
 * the identifier has to be read after the SDK identity has settled. Reading it
 * first lets a queued sign-out rotate the anonymous identifier between the
 * mapping write and the store purchase, and RevenueCat then reports the
 * purchase under an identifier the Game Backend cannot resolve (ADR-0045).
 */
export async function prepareGuestRevenueCatSubscriber(): Promise<string> {
  await synchronizeRevenueCatIdentity(null);
  return getRevenueCatSubscriberId();
}

export async function getRevenueCatSubscriberId(): Promise<string> {
  if (!(await initializeRevenueCat())) {
    throw new Error(useRevenueCatRuntime.getState().message ?? 'Commerce is not configured.');
  }
  const subscriberId = await Purchases.getAppUserID();
  if (!subscriberId || !(await Purchases.isAnonymous())) {
    throw new Error('Guest commerce requires the RevenueCat anonymous subscriber.');
  }
  return subscriberId;
}

export async function restoreRevenueCatPurchases(accountId: string | null): Promise<unknown> {
  await synchronizeRevenueCatIdentity(accountId);
  return Purchases.restorePurchases();
}

export async function isRevenueCatTrialEligible(productIdentifier: string): Promise<boolean> {
  if (!(await initializeRevenueCat())) return false;
  try {
    const eligibility = await Purchases.checkTrialOrIntroductoryPriceEligibility([
      storeProductKey(productIdentifier),
    ]);
    return eligibility[storeProductKey(productIdentifier)]?.status
      === INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE;
  } catch {
    // Unknown eligibility must show the normal paid offer rather than promise a trial.
    return false;
  }
}

export async function showRevenueCatManageSubscriptions(): Promise<void> {
  if (!(await initializeRevenueCat())) {
    throw new Error(useRevenueCatRuntime.getState().message ?? 'Commerce is not configured.');
  }
  await Purchases.showManageSubscriptions();
}

export function isRevenueCatConfigured(): boolean {
  return configured;
}

function revenueCatErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function storeProductKey(storeIdentifier: string): string {
  const separator = storeIdentifier.indexOf(':');
  return separator === -1 ? storeIdentifier : storeIdentifier.slice(0, separator);
}

export function resetRevenueCatForTests(): void {
  configured = false;
  initializationPromise = null;
  identityQueue = Promise.resolve();
  pendingForegroundResume?.remove();
  pendingForegroundResume = null;
  useRevenueCatRuntime.setState(INITIAL_STATE, true);
}
