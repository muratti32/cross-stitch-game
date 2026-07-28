import Purchases, {
  LOG_LEVEL,
  type MakePurchaseResult,
  type PurchasesOfferings,
  type PurchasesPackage,
} from 'react-native-purchases';
import { Platform } from 'react-native';
import { create } from 'zustand';

export type RevenueCatStoreMode = 'native' | 'test_store';
export type RevenueCatRuntimeStatus = 'disabled' | 'connecting' | 'ready' | 'error';

interface RevenueCatRuntimeState {
  status: RevenueCatRuntimeStatus;
  storeMode: RevenueCatStoreMode | null;
  associatedAccountId: string | null;
  message: string | null;
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
};

export const useRevenueCatRuntime = create<RevenueCatRuntimeState>(() => INITIAL_STATE);

let configured = false;
let initializationPromise: Promise<boolean> | null = null;
let identityQueue: Promise<void> = Promise.resolve();

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
      configured = true;
      useRevenueCatRuntime.setState({
        status: 'ready',
        storeMode: configuration.storeMode,
        associatedAccountId: null,
        message: null,
      });
      return true;
    } catch (error: unknown) {
      useRevenueCatRuntime.setState({
        status: 'error',
        storeMode: configuration.storeMode,
        associatedAccountId: null,
        message: revenueCatErrorMessage(error, 'RevenueCat could not be initialized.'),
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

      try {
        const currentUserId = await Purchases.getAppUserID();
        const isAnonymous = await Purchases.isAnonymous();

        if (accountId === null) {
          if (!isAnonymous) await Purchases.logOut();
          useRevenueCatRuntime.setState({
            status: 'ready',
            associatedAccountId: null,
            message: null,
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
        });
      } catch (error: unknown) {
        useRevenueCatRuntime.setState({
          status: 'error',
          associatedAccountId: null,
          message: revenueCatErrorMessage(error, 'RevenueCat identity could not be synchronized.'),
        });
        throw error;
      }
    });

  identityQueue = transition;
  return transition;
}

export async function getRevenueCatOfferings(): Promise<PurchasesOfferings> {
  if (!(await initializeRevenueCat())) {
    throw new Error(useRevenueCatRuntime.getState().message ?? 'Commerce is not configured.');
  }
  return Purchases.getOfferings();
}

export async function purchaseRevenueCatPackage(
  pkg: PurchasesPackage,
  accountId: string | null,
): Promise<MakePurchaseResult> {
  if (!accountId) {
    throw new Error('Sign in with a Registered Account before purchasing.');
  }
  await synchronizeRevenueCatIdentity(accountId);
  if (useRevenueCatRuntime.getState().associatedAccountId !== accountId) {
    throw new Error('Commerce could not verify the signed-in account. Try signing in again.');
  }
  return Purchases.purchasePackage(pkg);
}

export async function restoreRevenueCatPurchases(accountId: string | null): Promise<unknown> {
  if (!accountId) {
    throw new Error('Sign in with a Registered Account before restoring purchases.');
  }
  await synchronizeRevenueCatIdentity(accountId);
  return Purchases.restorePurchases();
}

export function isRevenueCatConfigured(): boolean {
  return configured;
}

function revenueCatErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function resetRevenueCatForTests(): void {
  configured = false;
  initializationPromise = null;
  identityQueue = Promise.resolve();
  useRevenueCatRuntime.setState(INITIAL_STATE, true);
}
