jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    checkTrialOrIntroductoryPriceEligibility: jest.fn(),
    getAppUserID: jest.fn(),
    getOfferings: jest.fn(),
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
}));

jest.mock('react-native', () => ({
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
import Purchases from 'react-native-purchases';

const mockPurchases = Purchases as jest.Mocked<typeof Purchases>;

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
    expect(mockPurchases.configure.mock.calls[0][0]).not.toHaveProperty('appUserID');
    expect(mockPurchases.logIn).not.toHaveBeenCalled();
    expect(mockPurchases.logOut).not.toHaveBeenCalled();
    expect(offerings.current?.availablePackages).toEqual([]);
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
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
