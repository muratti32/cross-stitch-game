jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    checkTrialOrIntroductoryPriceEligibility: jest.fn(),
    getAppUserID: jest.fn(),
    getOfferings: jest.fn(),
    enableAdServicesAttributionTokenCollection: jest.fn(),
    isAnonymous: jest.fn(),
    logIn: jest.fn(),
    logOut: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
    setLogLevel: jest.fn(),
    showManageSubscriptions: jest.fn(),
  },
  INTRO_ELIGIBILITY_STATUS: {
    INTRO_ELIGIBILITY_STATUS_UNKNOWN: 0,
    INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 1,
    INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 2,
    INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS: 3,
  },
  LOG_LEVEL: { DEBUG: 'DEBUG' },
  PURCHASES_ERROR_CODE: { UNKNOWN_BACKEND_ERROR: '16' },
}));

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(),
  },
  Platform: { OS: 'ios' },
}));

// Avoid triggering Expo's lazy native fetch module while Jest tears this
// SDK-only test environment down.
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value: jest.fn(),
  writable: true,
});

import {
  getRevenueCatOfferings,
  initializeRevenueCat,
  isRevenueCatTrialEligible,
  missingCanonicalRevenueCatProducts,
  purchaseRevenueCatPackage,
  resetRevenueCatForTests,
  resolveRevenueCatConfiguration,
  showRevenueCatManageSubscriptions,
  synchronizeRevenueCatIdentity,
  useRevenueCatRuntime,
} from '../revenueCat';
import Purchases, { PURCHASES_ERROR_CODE, type PurchasesError } from 'react-native-purchases';
import { AppState } from 'react-native';

const mockPurchases = Purchases as jest.Mocked<typeof Purchases>;

type AppStateListener = (status: 'active' | 'background' | 'inactive') => void;

const mockAppState = AppState as unknown as {
  currentState: 'active' | 'background' | 'inactive';
  addEventListener: jest.Mock;
};
const appStateListeners = new Set<AppStateListener>();

mockAppState.addEventListener.mockImplementation((_event: 'change', listener: AppStateListener) => {
  appStateListeners.add(listener);
  return { remove: () => appStateListeners.delete(listener) };
});

function setAppState(status: 'active' | 'background' | 'inactive'): void {
  mockAppState.currentState = status;
  appStateListeners.forEach((listener) => listener(status));
}

function unknownBackendError(): PurchasesError {
  return {
    code: PURCHASES_ERROR_CODE.UNKNOWN_BACKEND_ERROR,
    message: 'There was an unknown backend error. Rejecting receipt. (7934)',
    readableErrorCode: 'UnknownBackendError',
    userInfo: { readableErrorCode: 'UnknownBackendError' },
    underlyingErrorMessage: 'Rejecting receipt.',
    userCancelled: false,
  };
}

const originalEnvironment = {
  storeMode: process.env.EXPO_PUBLIC_REVENUECAT_STORE_MODE,
  testStoreApiKey: process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY,
  iosApiKey: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS,
  androidApiKey: process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID,
};

describe('RevenueCat commerce boundary', () => {
  let currentUserId: string;
  let anonymous: boolean;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRevenueCatForTests();
    appStateListeners.clear();
    mockAppState.currentState = 'active';
    process.env.EXPO_PUBLIC_REVENUECAT_STORE_MODE = 'test_store';
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY = 'test_public_key';
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS;
    delete process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;

    currentUserId = '$RCAnonymousID:catalog';
    anonymous = true;
    mockPurchases.getAppUserID.mockImplementation(async () => currentUserId);
    mockPurchases.isAnonymous.mockImplementation(async () => anonymous);
    mockPurchases.logIn.mockImplementation(async (accountId: string) => {
      currentUserId = accountId;
      anonymous = false;
      return { created: true, customerInfo: {} } as never;
    });
    mockPurchases.logOut.mockImplementation(async () => {
      currentUserId = '$RCAnonymousID:after-logout';
      anonymous = true;
      return {} as never;
    });
    mockPurchases.getOfferings.mockResolvedValue({
      current: { availablePackages: [] },
    } as never);
  });

  afterAll(() => {
    restoreEnvironment('EXPO_PUBLIC_REVENUECAT_STORE_MODE', originalEnvironment.storeMode);
    restoreEnvironment('EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY', originalEnvironment.testStoreApiKey);
    restoreEnvironment('EXPO_PUBLIC_REVENUECAT_API_KEY_IOS', originalEnvironment.iosApiKey);
    restoreEnvironment('EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID', originalEnvironment.androidApiKey);
  });

  test('configures Test Store anonymously and exposes its catalog to a Guest', async () => {
    await synchronizeRevenueCatIdentity(null);
    const offerings = await getRevenueCatOfferings();

    expect(mockPurchases.configure).toHaveBeenCalledTimes(1);
    expect(mockPurchases.configure).toHaveBeenCalledWith({ apiKey: 'test_public_key' });
    expect(mockPurchases.enableAdServicesAttributionTokenCollection).toHaveBeenCalledTimes(1);
    expect(mockPurchases.configure.mock.calls[0][0]).not.toHaveProperty('appUserID');
    expect(mockPurchases.logIn).not.toHaveBeenCalled();
    expect(mockPurchases.logOut).not.toHaveBeenCalled();
    expect(offerings.current?.availablePackages).toEqual([]);
  });

  test('keeps commerce ready when AdServices attribution collection fails', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockPurchases.enableAdServicesAttributionTokenCollection.mockRejectedValueOnce(
      new Error('AdServices unavailable'),
    );

    try {
      await expect(initializeRevenueCat()).resolves.toBe(true);
      expect(useRevenueCatRuntime.getState()).toMatchObject({ status: 'ready' });
      expect(warning).toHaveBeenCalledWith(
        'Apple Search Ads attribution collection deferred:',
        'AdServices unavailable',
      );
    } finally {
      warning.mockRestore();
    }
  });

  test('associates and removes a Registered Account exactly once across repeated calls', async () => {
    await Promise.all([
      synchronizeRevenueCatIdentity('account_77'),
      synchronizeRevenueCatIdentity('account_77'),
    ]);
    await Promise.all([
      synchronizeRevenueCatIdentity(null),
      synchronizeRevenueCatIdentity(null),
    ]);

    expect(mockPurchases.logIn).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn).toHaveBeenCalledWith('account_77');
    expect(mockPurchases.logOut).toHaveBeenCalledTimes(1);
    expect(useRevenueCatRuntime.getState()).toMatchObject({
      status: 'ready',
      associatedAccountId: null,
      storeMode: 'test_store',
    });
  });

  test('a restored Registered Account replaces an unrelated SDK identity', async () => {
    currentUserId = 'stale_account';
    anonymous = false;

    await synchronizeRevenueCatIdentity('restored_account');

    expect(mockPurchases.logIn).toHaveBeenCalledTimes(1);
    expect(mockPurchases.logIn).toHaveBeenCalledWith('restored_account');
    expect(useRevenueCatRuntime.getState().associatedAccountId).toBe('restored_account');
  });

  test('never allows an anonymous catalog session to purchase', async () => {
    await expect(purchaseRevenueCatPackage({} as never, null)).rejects.toThrow(
      'Sign in with a Registered Account',
    );
    expect(mockPurchases.purchasePackage).not.toHaveBeenCalled();
  });

  test('returns an AI Credit SDK transaction without treating purchase success as a grant', async () => {
    const sdkResult = {
      customerInfo: {},
      productIdentifier: 'com.avk.stitchwish.ai_credit_pack_5',
      transaction: {
        transactionIdentifier: 'store-transaction-82',
      },
    };
    mockPurchases.purchasePackage.mockResolvedValue(sdkResult as never);

    await expect(purchaseRevenueCatPackage(
      { identifier: '$rc_custom_ai_credit_pack_5' } as never,
      'account_82',
    )).resolves.toBe(sdkResult);

    expect(mockPurchases.purchasePackage).toHaveBeenCalledTimes(1);
    expect(useRevenueCatRuntime.getState().associatedAccountId).toBe('account_82');
  });

  test('invalid public configuration disables commerce without configuring the SDK', async () => {
    process.env.EXPO_PUBLIC_REVENUECAT_STORE_MODE = 'test_store';
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY = 'appl_wrong_store';

    await expect(initializeRevenueCat()).resolves.toBe(false);

    expect(mockPurchases.configure).not.toHaveBeenCalled();
    expect(useRevenueCatRuntime.getState()).toMatchObject({
      status: 'disabled',
      message: expect.stringContaining('invalid'),
    });
  });

  test('selects only the platform key in native store mode', () => {
    expect(resolveRevenueCatConfiguration({
      storeMode: 'native',
      testStoreApiKey: 'test_unused',
      iosApiKey: 'appl_ios',
      androidApiKey: 'goog_android',
    }, 'android')).toEqual({ storeMode: 'native', apiKey: 'goog_android' });
  });

  test('recognizes all nine canonical products, including Play base-plan suffixes', () => {
    const offerings = {
      current: {
        availablePackages: [
          'premium_weekly',
          'premium_monthly',
          'premium_annual',
          'coin_pack_300',
          'coin_pack_900',
          'coin_pack_2000',
          'ai_credit_pack_5',
          'ai_credit_pack_20',
          'ai_credit_pack_50',
        ].map((productId) => ({
          identifier: `$rc_${productId}`,
          product: {
            identifier: `com.avk.stitchwish.${productId}${productId.startsWith('premium_') ? `:${productId.slice('premium_'.length)}` : ''}`,
          },
        })),
      },
    };

    expect(missingCanonicalRevenueCatProducts(offerings as never)).toEqual([]);
  });

  test('reports a partially provisioned offering instead of exposing incomplete commerce', () => {
    expect(missingCanonicalRevenueCatProducts({
      current: { availablePackages: [] },
    } as never)).toHaveLength(9);
  });

  test('shows a trial only for explicit RevenueCat eligibility', async () => {
    mockPurchases.checkTrialOrIntroductoryPriceEligibility.mockResolvedValueOnce({
      'com.avk.stitchwish.premium_monthly': { status: 2, description: 'eligible' },
    });
    await expect(isRevenueCatTrialEligible(
      'com.avk.stitchwish.premium_monthly',
    )).resolves.toBe(true);

    mockPurchases.checkTrialOrIntroductoryPriceEligibility.mockResolvedValueOnce({
      'com.avk.stitchwish.premium_monthly': { status: 0, description: 'unknown' },
    });
    await expect(isRevenueCatTrialEligible(
      'com.avk.stitchwish.premium_monthly',
    )).resolves.toBe(false);
  });

  test('opens native subscription management through RevenueCat', async () => {
    mockPurchases.showManageSubscriptions.mockResolvedValue(undefined);
    await showRevenueCatManageSubscriptions();
    expect(mockPurchases.showManageSubscriptions).toHaveBeenCalledTimes(1);
  });

  describe('UnknownBackendError (7934) during initialize', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    test('retries a bounded number of times, then stops and leaves the identity unresolved rather than not-entitled', async () => {
      jest.useFakeTimers();
      mockPurchases.getAppUserID.mockRejectedValue(unknownBackendError());

      const synchronizing = synchronizeRevenueCatIdentity(null);
      const assertion = expect(synchronizing).rejects.toMatchObject({
        code: PURCHASES_ERROR_CODE.UNKNOWN_BACKEND_ERROR,
      });

      // Exhausts the bounded retry budget (2s, 5s, 15s backoff).
      await jest.advanceTimersByTimeAsync(2_000);
      await jest.advanceTimersByTimeAsync(5_000);
      await jest.advanceTimersByTimeAsync(15_000);
      await assertion;

      // One initial attempt plus exactly three retries - never unbounded.
      expect(mockPurchases.getAppUserID).toHaveBeenCalledTimes(4);

      const callsAfterExhaustion = mockPurchases.getAppUserID.mock.calls.length;
      await jest.advanceTimersByTimeAsync(120_000);
      expect(mockPurchases.getAppUserID).toHaveBeenCalledTimes(callsAfterExhaustion);

      // The identity could not be confirmed - this must never be conflated
      // with a confirmed absence of entitlement.
      expect(useRevenueCatRuntime.getState()).toMatchObject({
        status: 'error',
        associatedAccountId: null,
        initializeUnresolved: true,
      });
    });

    test('resolves normally once a retry succeeds', async () => {
      jest.useFakeTimers();
      mockPurchases.getAppUserID
        .mockRejectedValueOnce(unknownBackendError())
        .mockImplementation(async () => currentUserId);

      const synchronizing = synchronizeRevenueCatIdentity(null);
      await jest.advanceTimersByTimeAsync(2_000);
      await synchronizing;

      expect(mockPurchases.getAppUserID).toHaveBeenCalledTimes(2);
      expect(useRevenueCatRuntime.getState()).toMatchObject({
        status: 'ready',
        associatedAccountId: null,
        initializeUnresolved: false,
      });
    });

    test('never retries a non-backend error', async () => {
      mockPurchases.getAppUserID.mockRejectedValue(new Error('network hiccup'));

      await expect(synchronizeRevenueCatIdentity(null)).rejects.toThrow('network hiccup');

      expect(mockPurchases.getAppUserID).toHaveBeenCalledTimes(1);
      expect(useRevenueCatRuntime.getState()).toMatchObject({
        status: 'error',
        initializeUnresolved: true,
      });
    });

    test('abandons the retry (never parks) once the backoff elapses while backgrounded, then resumes automatically on foreground', async () => {
      jest.useFakeTimers();
      mockAppState.currentState = 'background';
      mockPurchases.getAppUserID
        .mockRejectedValueOnce(unknownBackendError())
        .mockImplementation(async () => currentUserId);

      const synchronizing = synchronizeRevenueCatIdentity(null);
      const assertion = expect(synchronizing).rejects.toMatchObject({
        code: PURCHASES_ERROR_CODE.UNKNOWN_BACKEND_ERROR,
      });
      await jest.advanceTimersByTimeAsync(2_000);

      // The backoff elapsed while the app was still backgrounded, so the
      // attempt is abandoned and the caller's promise settles now - it is
      // never parked waiting for a foreground event.
      await assertion;
      expect(mockPurchases.getAppUserID).toHaveBeenCalledTimes(1);
      expect(useRevenueCatRuntime.getState()).toMatchObject({
        status: 'error',
        initializeUnresolved: true,
      });

      // Foregrounding later triggers an automatic resume - independent of the
      // call above, which has already settled.
      setAppState('active');
      await jest.advanceTimersByTimeAsync(0);

      expect(mockPurchases.getAppUserID).toHaveBeenCalledTimes(2);
      expect(useRevenueCatRuntime.getState()).toMatchObject({ status: 'ready' });
    });

    test('always settles in bounded time and never blocks a later call, even if the app never returns to the foreground', async () => {
      jest.useFakeTimers();
      mockAppState.currentState = 'background';
      mockPurchases.getAppUserID.mockRejectedValue(unknownBackendError());

      const firstSync = synchronizeRevenueCatIdentity(null);
      const firstAssertion = expect(firstSync).rejects.toMatchObject({
        code: PURCHASES_ERROR_CODE.UNKNOWN_BACKEND_ERROR,
      });

      // Only the first backoff (2s) elapses before the attempt is abandoned -
      // nowhere near the full 2s+5s+15s retry budget, and nothing waits on a
      // foreground event that, in this test, never comes.
      await jest.advanceTimersByTimeAsync(2_000);
      await firstAssertion;

      // A second, independent call is not blocked behind the first - it runs
      // its own bounded attempt immediately rather than inheriting any wait.
      const secondSync = synchronizeRevenueCatIdentity(null);
      const secondAssertion = expect(secondSync).rejects.toMatchObject({
        code: PURCHASES_ERROR_CODE.UNKNOWN_BACKEND_ERROR,
      });
      await jest.advanceTimersByTimeAsync(2_000);
      await secondAssertion;

      // Nothing is left pending indefinitely: advancing far past any
      // conceivable backoff produces no further activity.
      const callsSoFar = mockPurchases.getAppUserID.mock.calls.length;
      await jest.advanceTimersByTimeAsync(10 * 60_000);
      expect(mockPurchases.getAppUserID).toHaveBeenCalledTimes(callsSoFar);
    });
  });
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
