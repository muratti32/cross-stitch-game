import React from 'react';
import {
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import CommerceScreen from '../../../app/(tabs)/(profile)/commerce';
import { WebLinks } from '@/config';
import { Theme } from '@/theme/theme';
import { useCommerceIntentStore } from '../commerceIntent';

let mockParams: { category?: string; source?: string } = { source: 'profile' };
let mockIdentity = { accountId: null as string | null, isAccount: false };
let mockAiCreditWalletBalance = 4;
let mockMembership: Record<string, unknown> | undefined;

const mockRouter = {
  back: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};
const mockCaptureGameplayEvent = jest.fn().mockResolvedValue(undefined);
// Gameplay Events now carry mirror-only arguments (ADR-0055), so "was this kind
// ever reported?" is asserted on the kinds themselves rather than on an exact
// argument list that would silently stop matching.
const capturedEventKinds = (): unknown[] =>
  mockCaptureGameplayEvent.mock.calls.map(([kind]) => kind);
const mockGetOfferings = jest.fn();
const mockMissingCanonicalProducts = jest.fn();
const mockPurchasePackage = jest.fn();
const mockRestorePurchases = jest.fn();
const mockTrialEligible = jest.fn();
const mockManageSubscriptions = jest.fn();
const mockCreateReconciliation = jest.fn();
const mockFetchMembership = jest.fn();
const mockFetchAiCreditBalance = jest.fn();
const mockRefetchQueries = jest.fn().mockResolvedValue(undefined);
const mockSetQueryData = jest.fn();
const mockCreateCoinPackReconciliation = jest.fn();
const mockFetchCoinPackReconciliation = jest.fn();
const mockFetchCoinBalance = jest.fn();
const mockCreateGuestPurchaseAttempt = jest.fn();
const mockCancelGuestPurchaseAttempt = jest.fn();
const mockFetchGuestPurchaseAttempt = jest.fn();
const mockMapGuestRevenueCatSubscriber = jest.fn();
const mockCreateAiCreditPackReconciliation = jest.fn();
const mockFetchAiCreditPackReconciliation = jest.fn();
let renderer: TestRenderer.ReactTestRenderer | null = null;

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => mockRouter,
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    refetchQueries: mockRefetchQueries,
    setQueryData: mockSetQueryData,
  }),
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => React.createElement(Text, null, name),
  };
});

jest.mock('@/components', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    Screen: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    Card: ({
      children,
      onPress,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
    }) => React.createElement(onPress ? Pressable : View, onPress ? { onPress } : null, children),
    Button: ({
      title,
      onPress,
      disabled,
    }: {
      title: string;
      onPress: () => void;
      disabled?: boolean;
    }) => React.createElement(
      Pressable,
      { disabled, onPress },
      React.createElement(Text, null, title),
      ),
    GuestDataRiskNotice: ({ visible, onProceed, onSignIn, onDismiss }: {
      visible: boolean;
      onProceed: () => void;
      onSignIn: () => void;
      onDismiss: () => void;
    }) => visible
      ? React.createElement(require('react-native').Modal, { visible },
        React.createElement(View, null,
          React.createElement(Pressable, { onPress: onProceed }, React.createElement(Text, null, 'Continue as Guest')),
          React.createElement(Pressable, { onPress: onSignIn }, React.createElement(Text, null, 'Sign in instead')),
          React.createElement(Pressable, { onPress: onDismiss }, React.createElement(Text, null, 'Dismiss')),
        ),
      )
      : null,
    // The purchase result modal is exercised for real here: its variant copy
    // and button labels are part of what the player observes.
    PurchaseResultModal: require('@/components/PurchaseResultModal').PurchaseResultModal,
  };
});

jest.mock('@/identity/guestIdentity', () => ({
  useIdentityStore: () => mockIdentity,
}));

jest.mock('@/api/economy', () => ({
  fetchCoinBalance: (...args: unknown[]) => mockFetchCoinBalance(...args),
  useCoinBalance: () => ({ data: 120 }),
}));

jest.mock('@/api/coinPack', () => ({
  createCoinPackReconciliation: (...args: unknown[]) => mockCreateCoinPackReconciliation(...args),
  fetchCoinPackReconciliation: (...args: unknown[]) => mockFetchCoinPackReconciliation(...args),
}));

jest.mock('@/api/aiCreditPack', () => ({
  createAiCreditPackReconciliation: (...args: unknown[]) =>
    mockCreateAiCreditPackReconciliation(...args),
  fetchAiCreditPackReconciliation: (...args: unknown[]) =>
    mockFetchAiCreditPackReconciliation(...args),
}));

jest.mock('@/api/commerce', () => ({
  fetchAiCreditBalance: (...args: unknown[]) => mockFetchAiCreditBalance(...args),
  useAiCreditBalance: () => ({ data: mockAiCreditWalletBalance }),
}));

jest.mock('@/api/membership', () => ({
  createPremiumReconciliation: (...args: unknown[]) => mockCreateReconciliation(...args),
  fetchMembership: (...args: unknown[]) => mockFetchMembership(...args),
  useMembership: () => ({ data: mockMembership }),
  usePremiumDailyClaim: () => ({
    data: undefined,
    error: null,
    isPending: false,
    mutate: jest.fn(),
  }),
}));

jest.mock('@/membership/themes', () => ({
  MEMBERSHIP_THEMES: [],
  useActiveMembershipTheme: () => ({
    selectTheme: jest.fn(),
    theme: { id: 'default' },
    themeAccess: false,
  }),
}));

jest.mock('@/analytics/gameplayEvents', () => ({
  captureGameplayEvent: (...args: unknown[]) => mockCaptureGameplayEvent(...args),
}));

const mockGetSubscriberId = jest.fn<Promise<string>, unknown[]>();
const mockPrepareGuestSubscriber = jest.fn<Promise<string>, unknown[]>();

jest.mock('@/commerce/revenueCat', () => ({
  getRevenueCatOfferings: (...args: unknown[]) => mockGetOfferings(...args),
  isRevenueCatTrialEligible: (...args: unknown[]) => mockTrialEligible(...args),
  missingCanonicalRevenueCatProducts: (...args: unknown[]) =>
    mockMissingCanonicalProducts(...args),
  purchaseRevenueCatPackage: (...args: unknown[]) => mockPurchasePackage(...args),
  restoreRevenueCatPurchases: (...args: unknown[]) => mockRestorePurchases(...args),
  showRevenueCatManageSubscriptions: (...args: unknown[]) => mockManageSubscriptions(...args),
  useRevenueCatRuntime: () => ({ message: null, status: 'ready' }),
  getRevenueCatSubscriberId: (...args: unknown[]) => mockGetSubscriberId(...args),
  prepareGuestRevenueCatSubscriber: (...args: unknown[]) => mockPrepareGuestSubscriber(...args),
}));

jest.mock('@/api/guestPurchase', () => ({
  cancelGuestPurchaseAttempt: (...args: unknown[]) => mockCancelGuestPurchaseAttempt(...args),
  createGuestPurchaseAttempt: (...args: unknown[]) => mockCreateGuestPurchaseAttempt(...args),
  fetchGuestPurchaseAttempt: (...args: unknown[]) => mockFetchGuestPurchaseAttempt(...args),
  mapGuestRevenueCatSubscriber: (...args: unknown[]) => mockMapGuestRevenueCatSubscriber(...args),
}));

const productRows = [
  ['premium_annual', '$39.99'],
  ['premium_monthly', '$7.99'],
  ['premium_weekly', '$2.99'],
  ['coin_pack_300', '$1.99'],
  ['coin_pack_900', '$4.99'],
  ['coin_pack_2000', '$9.99'],
  ['ai_credit_pack_5', '$2.99'],
  ['ai_credit_pack_20', '$9.99'],
  ['ai_credit_pack_50', '$19.99'],
] as const;

// The store, not the app, decides which products carry an introductory offer,
// how long it runs, and whether it costs anything; `introductoryOffers` mirrors
// that store configuration and `introPrice` its price. `withheldProductKeys`
// drops the packages the current offering does not return at all.
function offering(
  introductoryOffers: Readonly<Record<string, string>> = { premium_monthly: 'P3D' },
  introPrice = 0,
  withheldProductKeys: readonly string[] = [],
) {
  return {
    current: {
      availablePackages: productRows
        .filter(([key]) => !withheldProductKeys.includes(key))
        .map(([key, priceString]) => ({
          identifier: `$rc_${key}`,
          product: {
            // The store reports a numeric price and currency beside the display
            // string; ADR-0055 forwards those to the Analytics Mirror only.
            currencyCode: 'USD',
            price: Number(priceString.replace('$', '')),
            identifier: `com.avk.stitchwish.${key}`,
            introPrice: introductoryOffers[key] === undefined
              ? null
              : {
                cycles: 1,
                period: introductoryOffers[key],
                periodNumberOfUnits: Number(/\d+/.exec(introductoryOffers[key])?.[0] ?? 0),
                periodUnit: 'DAY',
                price: introPrice,
                priceString: `$${introPrice.toFixed(2)}`,
              },
            priceString,
            subscriptionPeriod: key === 'premium_annual'
              ? 'P1Y'
              : key === 'premium_monthly'
                ? 'P1M'
                : key === 'premium_weekly'
                  ? 'P1W'
                  : null,
          },
        })),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { source: 'profile' };
  mockIdentity = { accountId: null, isAccount: false };
  mockAiCreditWalletBalance = 4;
  mockMembership = undefined;
  mockGetOfferings.mockResolvedValue(offering());
  mockMissingCanonicalProducts.mockReturnValue([]);
  mockPurchasePackage.mockResolvedValue({
    transaction: { transactionIdentifier: 'store-transaction-81' },
  });
  mockRestorePurchases.mockResolvedValue({});
  mockTrialEligible.mockResolvedValue(false);
  mockManageSubscriptions.mockResolvedValue(undefined);
  mockCreateReconciliation.mockResolvedValue({ supportReference: 'SW-ABCD-EFGH' });
  mockFetchMembership.mockResolvedValue(inactiveMembership());
  mockFetchAiCreditBalance.mockResolvedValue(4);
  mockCreateCoinPackReconciliation.mockResolvedValue({
    id: '86d57c4b-4329-4f8c-a37f-b26c3bdca304',
    supportReference: 'SW-COIN-PACK',
  });
  mockFetchCoinPackReconciliation.mockResolvedValue({ status: 'pending', balance: null });
  mockFetchCoinBalance.mockResolvedValue(420);
  mockMapGuestRevenueCatSubscriber.mockResolvedValue(undefined);
  mockGetSubscriberId.mockResolvedValue('anonymous-subscriber');
  mockPrepareGuestSubscriber.mockResolvedValue('anonymous-subscriber');
  mockCreateGuestPurchaseAttempt.mockResolvedValue({
    id: 'guest-attempt-81', status: 'created', productId: 'com.avk.stitchwish.coin_pack_300',
    supportReference: 'SW-GUEST-COIN', providerTransactionId: null,
  });
  mockCancelGuestPurchaseAttempt.mockResolvedValue({ status: 'cancelled' });
  mockFetchGuestPurchaseAttempt.mockResolvedValue({ status: 'granted', balance: 420 });
  mockCreateAiCreditPackReconciliation.mockResolvedValue({
    id: '86d57c4b-4329-4f8c-a37f-b26c3bdca382',
    supportReference: 'SW-AI-CREDIT',
  });
  mockFetchAiCreditPackReconciliation.mockResolvedValue({ status: 'pending', balance: null });
  useCommerceIntentStore.getState().clearIntent();
});

it('selects Annual as Best Value and reads periods and eligible trial from RevenueCat', async () => {
  mockTrialEligible.mockResolvedValue(true);
  await renderScreen();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'BEST VALUE',
    'Billed every 1 year',
    'Billed every 1 month',
    'Billed every 1 week',
    'Free for 3 days, then $7.99 every 1 month',
  ]));
  expect(renderer!.root.findByProps({ testID: 'premium-premium_annual' }).props.style)
    .toBeDefined();
  expect(mockTrialEligible).toHaveBeenCalledWith('com.avk.stitchwish.premium_monthly');
});

it('shows the normal Monthly paid offer when eligibility is unknown or ineligible', async () => {
  mockTrialEligible.mockResolvedValue(false);
  await renderScreen();

  expect(allText(renderer!.root).join(' ')).not.toContain('Free for');
  expect(allText(renderer!.root)).toContain('$7.99');
});

it('reads the trial duration from the store introductory offer rather than the app', async () => {
  mockGetOfferings.mockResolvedValue(offering({ premium_monthly: 'P1W' }));
  mockTrialEligible.mockResolvedValue(true);
  await renderScreen();

  expect(mockTrialEligible).toHaveBeenCalledWith('com.avk.stitchwish.premium_monthly');
  expect(mockTrialEligible).toHaveBeenCalledTimes(1);
  expect(allText(renderer!.root)).toContain('Free for 1 week, then $7.99 every 1 month');
  expect(allText(renderer!.root).join(' ')).not.toContain('3 days');
});

it('renders the ordinary paid offer when the store advertises no introductory offer', async () => {
  mockGetOfferings.mockResolvedValue(offering({}));
  mockTrialEligible.mockResolvedValue(true);
  await renderScreen();

  expect(mockTrialEligible).not.toHaveBeenCalled();
  expect(allText(renderer!.root).join(' ')).not.toContain('Free for');
  expect(allText(renderer!.root)).toEqual(expect.arrayContaining(['$7.99', '$2.99', '$39.99']));
});

it('never advertises a paid introductory offer as free', async () => {
  // RevenueCat reports paid introductory prices through the same introPrice
  // field; a discounted first period is not a trial.
  mockGetOfferings.mockResolvedValue(offering({ premium_monthly: 'P1M' }, 0.99));
  mockTrialEligible.mockResolvedValue(true);
  await renderScreen();

  expect(mockTrialEligible).not.toHaveBeenCalled();
  expect(allText(renderer!.root).join(' ')).not.toContain('Free for');
  expect(allText(renderer!.root)).toContain('$7.99');
});

it('states each AI Credit allowance against that plan’s own paid period', async () => {
  await renderScreen();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    '180 credits / paid year',
    '15 credits / paid month',
    '3 credits / paid week',
  ]));
  expect(allText(renderer!.root).join(' ')).not.toContain('credits / paid period');
});

it('repeats the store introductory offer inside the Premium confirmation', async () => {
  mockIdentity = { accountId: 'account_80', isAccount: true };
  mockTrialEligible.mockResolvedValue(true);
  await renderScreen();

  await act(async () => {
    pressAncestor(renderer!.root.findByProps({ testID: 'premium-premium_monthly' }));
  });
  await act(async () => pressByText(renderer!.root, 'Choose Monthly'));

  expect(allText(renderer!.root)).toContain(
    'Your store reports this introductory offer: Free for 3 days, then $7.99 every 1 month.',
  );
});

it('discloses the store subscription terms above the Premium purchase action', async () => {
  mockIdentity = { accountId: 'account_80', isAccount: true };
  await renderScreen();

  const text = allText(renderer!.root);
  expect(text).toContain(
    'Payment is charged to your App Store account at confirmation. Annual Premium renews '
    + 'automatically at $39.99 every 1 year unless auto-renew is turned off at least 24 hours '
    + 'before the end of the current period. Any unused portion of a free trial is forfeited '
    + 'when you purchase a subscription. You can cancel at any time from your App Store account.',
  );
  expect(allText(subscriptionDisclosure())).toEqual(expect.arrayContaining([
    'Privacy Policy',
    'Terms of Service',
  ]));
  expect(text.indexOf('Privacy Policy')).toBeLessThan(text.indexOf('Choose Annual'));
});

it('keeps the store disclosure compact while the confirmation disclosure remains a card', async () => {
  mockIdentity = { accountId: 'account_80', isAccount: true };
  await renderScreen();

  expect(StyleSheet.flatten(subscriptionDisclosure().findByType(View).props.style)).toMatchObject({
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
  });

  await act(async () => pressByText(renderer!.root, 'Choose Annual'));

  expect(StyleSheet.flatten(
    renderer!.root
      .findByProps({ testID: 'premium-confirmation-disclosure' })
      .findByType(View).props.style,
  )).toMatchObject({
    borderWidth: 1,
  });
});

it('interpolates the disclosure from the selected Premium Plan', async () => {
  mockIdentity = { accountId: 'account_80', isAccount: true };
  await renderScreen();

  await act(async () => {
    pressAncestor(renderer!.root.findByProps({ testID: 'premium-premium_weekly' }));
  });

  expect(allText(subscriptionDisclosure()).join(' ')).toContain(
    'Weekly Premium renews automatically at $2.99 every 1 week unless auto-renew is turned off',
  );
});

it('names the store the player is holding', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  try {
    await renderScreen();

    const disclosure = allText(subscriptionDisclosure()).join(' ');
    expect(disclosure).toContain(
      'Payment is charged to your Google Play account at confirmation.',
    );
    expect(disclosure).toContain('You can cancel at any time from your Google Play account.');
    expect(disclosure).not.toContain('App Store');
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  }
});

it('repeats the disclosure and both links inside the Premium confirmation', async () => {
  mockIdentity = { accountId: 'account_80', isAccount: true };
  await renderScreen();

  await act(async () => pressByText(renderer!.root, 'Choose Annual'));

  const confirmation = allText(
    renderer!.root.findByProps({ testID: 'premium-confirmation-disclosure' }),
  );
  expect(confirmation.join(' ')).toContain(
    'Annual Premium renews automatically at $39.99 every 1 year',
  );
  expect(confirmation).toEqual(expect.arrayContaining(['Privacy Policy', 'Terms of Service']));
});

it('opens the configured Privacy Policy and Terms of Service from the disclosure', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await renderScreen();

  await act(async () => pressByText(subscriptionDisclosure(), 'Privacy Policy'));
  await act(async () => pressByText(subscriptionDisclosure(), 'Terms of Service'));

  expect(openURL).toHaveBeenNthCalledWith(1, WebLinks.privacyPolicy);
  expect(openURL).toHaveBeenNthCalledWith(2, WebLinks.termsOfService);
  openURL.mockRestore();
});

it('tells the player when a legal link cannot be opened', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await renderScreen();

  await act(async () => {
    pressByText(subscriptionDisclosure(), 'Terms of Service');
    await flushPromises();
  });

  expect(alert).toHaveBeenCalledWith(
    'Terms of Service',
    `Could not open link: ${WebLinks.termsOfService}`,
  );
  alert.mockRestore();
  openURL.mockRestore();
});

it('requires confirmation and treats store cancellation as a non-error', async () => {
  mockIdentity = { accountId: 'account_80', isAccount: true };
  mockPurchasePackage.mockRejectedValue({ userCancelled: true });
  await renderScreen();

  await act(async () => pressByText(renderer!.root, 'Choose Annual'));
  expect(allText(renderer!.root)).toContain('Confirm Premium purchase');
  expect(mockPurchasePackage).not.toHaveBeenCalled();

  await act(async () => {
    pressByText(renderer!.root, 'Confirm Annual');
    await flushPromises();
  });

  expect(mockPurchasePackage).not.toHaveBeenCalled();
  expect(mockCaptureGameplayEvent).not.toHaveBeenCalledWith(
    'purchase_started',
    expect.anything(),
  );

  await dismissPremiumConfirmation();

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_started', {
    product_kind: 'premium_membership',
    product_key: 'premium_annual',
  });
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_cancelled', {
    product_kind: 'premium_membership',
    product_key: 'premium_annual',
  });
  expect(allText(renderer!.root)).not.toContain('Purchase Reconciliation Pending');
});

it('does not wait for the iOS-only modal dismissal callback on Android', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  try {
    mockIdentity = { accountId: 'account_80', isAccount: true };
    mockPurchasePackage.mockRejectedValue({ userCancelled: true });
    await renderScreen();

    await act(async () => pressByText(renderer!.root, 'Choose Annual'));
    await act(async () => {
      pressByText(renderer!.root, 'Confirm Annual');
      await flushPromises();
    });

    expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  }
});

it('stays pending with a Support Reference until the backend verifies membership', async () => {
  mockIdentity = { accountId: 'account_80', isAccount: true };
  mockPurchasePackage.mockResolvedValue({});
  await renderScreen();

  await confirmAnnualPurchase();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase Reconciliation Pending',
    'Support Reference: SW-ABCD-EFGH',
  ]));
  expect(capturedEventKinds()).not.toContain('purchase_completed');
  expect(pressableByText(renderer!.root, 'Choose Annual').props.disabled).toBe(true);
});

it('emits completion only after verified membership and AI Credit refresh', async () => {
  mockIdentity = { accountId: 'account_80', isAccount: true };
  mockPurchasePackage.mockResolvedValue({});
  mockFetchMembership
    .mockResolvedValueOnce(inactiveMembership())
    .mockResolvedValue(activeMembership('annual'));
  mockFetchAiCreditBalance.mockResolvedValue(184);
  await renderScreen();

  await confirmAnnualPurchase();

  expect(mockFetchAiCreditBalance).toHaveBeenCalled();
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith(
    'purchase_completed',
    { product_kind: 'premium_membership', product_key: 'premium_annual' },
    undefined,
    { currency: 'USD', value: 39.99 },
  );
  expect(allText(renderer!.root)).toContain('Annual Premium is verified and active.');
  expect(allText(renderer!.root)).not.toContain('Purchase Reconciliation Pending');
});

it('carries the purchase result modal from pending to a verified Premium grant with its billing period', async () => {
  mockIdentity = { accountId: 'account_premium_modal', isAccount: true };
  mockPurchasePackage.mockResolvedValue({});
  let resolveVerification: (value: ReturnType<typeof activeMembership>) => void = () => undefined;
  mockFetchMembership
    .mockResolvedValueOnce(inactiveMembership())
    .mockReturnValueOnce(new Promise((resolve) => { resolveVerification = resolve; }));
  await renderScreen();

  await act(async () => pressByText(renderer!.root, 'Choose Annual'));
  await act(async () => {
    pressByText(renderer!.root, 'Confirm Annual');
    await flushPromises();
  });
  await dismissPremiumConfirmation();

  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase received',
    'The store accepted Annual. Verifying your purchase now.',
  ]));

  await act(async () => {
    resolveVerification(activeMembership('annual'));
    await flushPromises();
  });

  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'Premium is active',
    'Annual Premium is now active, billed every 1 year.',
  ]));
});

it('reports backend verification failures before opening the store', async () => {
  mockIdentity = { accountId: 'account_80', isAccount: true };
  mockFetchMembership.mockRejectedValue(new Error('backend offline'));
  await renderScreen();

  await confirmAnnualPurchase();

  expect(mockPurchasePackage).not.toHaveBeenCalled();
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_failed', {
    product_kind: 'premium_membership',
    product_key: 'premium_annual',
    failure_stage: 'verification',
  });
  expect(allText(renderer!.root)).toContain('backend offline');
});

it('keeps verified Premium pending when AI Credit refresh fails at the grant stage', async () => {
  mockIdentity = { accountId: 'account_80', isAccount: true };
  mockFetchMembership
    .mockResolvedValueOnce(inactiveMembership())
    .mockResolvedValue(activeMembership('annual'));
  mockFetchAiCreditBalance.mockRejectedValue(new Error('grant refresh failed'));
  await renderScreen();

  await confirmAnnualPurchase();

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_failed', {
    product_kind: 'premium_membership',
    product_key: 'premium_annual',
    failure_stage: 'grant',
  });
  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase Reconciliation Pending',
    'Retry reconciliation',
    'Premium was verified, but membership and AI Credit state could not be refreshed. Retry reconciliation.',
  ]));
  // The stale "Verifying your purchase now" pending modal must not survive a
  // terminal failure — it flips to the failed variant carrying the same
  // reason the page-level banner shows.
  expect(resultModalText(renderer!.root).join(' ')).not.toContain('Verifying your purchase now');
  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase failed',
    'Premium was verified, but membership and AI Credit state could not be refreshed. Retry reconciliation.',
  ]));
});

it('keeps a prolonged reconciliation pending and offers Retry without repurchase', async () => {
  const now = jest.spyOn(Date, 'now')
    .mockReturnValueOnce(1_000)
    .mockReturnValueOnce(1_000)
    .mockReturnValue(12_000);
  mockIdentity = { accountId: 'account_80', isAccount: true };
  mockPurchasePackage.mockResolvedValue({});
  await renderScreen();
  await confirmAnnualPurchase();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase Reconciliation Pending',
    'Retry reconciliation',
    'Support Reference: SW-ABCD-EFGH',
  ]));
  expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
  // A prolonged wait is not a failure: the modal moves to the informational
  // variant instead of flipping to the failed variant, and offers no retry
  // of its own — Retry stays on the page-level banner above.
  expect(resultModalVisible(renderer!.root)).toBe(true);
  const modalText = resultModalText(renderer!.root);
  expect(modalText).toEqual(expect.arrayContaining([
    'Still verifying',
  ]));
  expect(modalText.join(' ').toLowerCase()).not.toContain('fail');
  expect(modalText.join(' ').toLowerCase()).not.toContain('try again');
  expect(modalText.join(' ').toLowerCase()).not.toContain('buy it again');
  now.mockRestore();
});

it('flips from pending to the informational variant once verification runs past the internal threshold', async () => {
  // Fake timers here only: modern fake timers fake Date.now, so advancing them
  // is what actually crosses the screen's internal RECONCILIATION_DELAY_MS
  // threshold rather than mocking Date.now directly. The rest of the suite
  // keeps real timers.
  jest.useFakeTimers();
  try {
    mockIdentity = { accountId: 'account_prolonged_fake_timers', isAccount: true };
    mockPurchasePackage.mockResolvedValue({});
    // Never terminal: membership stays inactive on every poll.
    mockFetchMembership.mockResolvedValue(inactiveMembership());
    await renderScreen();

    await act(async () => pressByText(renderer!.root, 'Choose Annual'));
    await act(async () => {
      pressByText(renderer!.root, 'Confirm Annual');
      await flushPromises();
    });
    await dismissPremiumConfirmation();

    expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
      'Purchase received',
    ]));

    // Advance past the ~10s threshold in RECONCILIATION_POLL_MS-sized steps,
    // flushing the reconciliation promise chain between each poll.
    for (let elapsed = 0; elapsed < 12_000; elapsed += 2_000) {
      await act(async () => {
        jest.advanceTimersByTime(2_000);
        await flushPromises();
      });
    }

    const modalText = resultModalText(renderer!.root);
    expect(modalText).toEqual(expect.arrayContaining([
      'Still verifying',
      'Verification is still under way. Premium will activate once the Game Backend confirms it.',
    ]));
    expect(modalText).not.toEqual(expect.arrayContaining(['Purchase received']));
    expect(modalText.join(' ').toLowerCase()).not.toContain('fail');
    expect(modalText.join(' ').toLowerCase()).not.toContain('try again');
    expect(modalText.join(' ').toLowerCase()).not.toContain('buy it again');
  } finally {
    jest.useRealTimers();
  }
});

it('routes restore through pending and completes from the backend-observed plan', async () => {
  mockIdentity = { accountId: 'account_80', isAccount: true };
  mockRestorePurchases.mockResolvedValue({});
  mockFetchMembership.mockResolvedValue(activeMembership('monthly'));
  await renderScreen();

  await act(async () => {
    pressByText(renderer!.root, 'Restore purchases');
    await flushPromises();
  });

  expect(mockCreateReconciliation).toHaveBeenCalledWith('restore', null);
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_reconciliation_pending', {
    product_kind: 'premium_membership',
    product_key: 'premium_annual',
  });
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith(
    'purchase_completed',
    { product_kind: 'premium_membership', product_key: 'premium_monthly' },
    undefined,
    { currency: 'USD', value: 7.99 },
  );
});

it('restores a Guest Player Premium entitlement through the informational modal, not a native alert', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await renderScreen();

  expect(allText(renderer!.root)).toContain('Restore Guest Premium');

  await act(async () => {
    pressByText(renderer!.root, 'Restore Guest Premium');
    await flushPromises();
  });

  expect(mockMapGuestRevenueCatSubscriber).toHaveBeenCalledWith('anonymous-subscriber');
  expect(mockRestorePurchases).toHaveBeenCalledWith(null);
  expect(alert).not.toHaveBeenCalled();
  expect(resultModalVisible(renderer!.root)).toBe(true);
  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'Restore requested',
  ]));
  expect(resultModalText(renderer!.root).join(' ')).toContain(
    'Verified Premium access will appear after the store webhook is reconciled.',
  );
  expect(resultModalText(renderer!.root).join(' ')).toContain(
    'Stitch Coin and AI Credit packs are never restored.',
  );
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockCreateReconciliation).not.toHaveBeenCalled();
  alert.mockRestore();
});

it('lets a Guest purchase Premium end-to-end without ever requiring registration', async () => {
  // Guideline 5.1.1(v): the CTA must never read as a sign-in requirement, and
  // choosing it must not require becoming a Registered Account to complete.
  mockFetchMembership
    .mockResolvedValueOnce(inactiveMembership())
    .mockResolvedValue(activeMembership('annual'));
  await renderScreen();

  expect(pressableByText(renderer!.root, 'Choose Annual')).toBeTruthy();
  expect(allText(renderer!.root)).not.toContain('Sign in for Annual');

  await act(async () => pressByText(renderer!.root, 'Choose Annual'));
  expect(allText(renderer!.root)).toContain('Continue as Guest');

  await act(async () => pressByText(renderer!.root, 'Continue as Guest'));
  expect(allText(renderer!.root)).toContain('Confirm Premium purchase');

  await act(async () => pressByText(renderer!.root, 'Confirm Annual'));
  await dismissPremiumConfirmation();

  expect(mockMapGuestRevenueCatSubscriber).toHaveBeenCalledWith('anonymous-subscriber');
  expect(mockCreateGuestPurchaseAttempt).toHaveBeenCalledWith(
    'com.avk.stitchwish.premium_annual', expect.any(String), 'anonymous-subscriber',
  );
  expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(allText(renderer!.root)).toContain('Annual Premium is verified and active.');
});

it('cancels the prepared Guest attempt when the store rejects the purchase', async () => {
  mockPurchasePackage.mockRejectedValue({ code: '42', userCancelled: false });
  await renderScreen();

  await act(async () => pressByText(renderer!.root, 'Choose Annual'));
  await act(async () => pressByText(renderer!.root, 'Continue as Guest'));
  await act(async () => pressByText(renderer!.root, 'Confirm Annual'));
  await dismissPremiumConfirmation();

  expect(mockCancelGuestPurchaseAttempt).toHaveBeenCalledWith('guest-attempt-81');
  expect(mockFetchGuestPurchaseAttempt).not.toHaveBeenCalled();
});

it('shows a Guest Player the Support Reference when the purchase fails', async () => {
  // Support cannot locate the Purchase Attempt without the reference, so the
  // failure modal carries it as the detail line for a Guest Player.
  mockPurchasePackage.mockRejectedValue(new Error('store unavailable'));
  await renderScreen();

  await act(async () => pressByText(renderer!.root, 'Choose Annual'));
  await act(async () => pressByText(renderer!.root, 'Continue as Guest'));
  await act(async () => pressByText(renderer!.root, 'Confirm Annual'));
  await dismissPremiumConfirmation();

  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase failed',
    'Support Reference: SW-GUEST-COIN',
  ]));
});

it('leaves a Registered Account restore on the Purchase Reconciliation path', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockIdentity = { accountId: 'account_80', isAccount: true };
  await renderScreen();

  expect(allText(renderer!.root)).toContain('Restore purchases');

  await act(async () => {
    pressByText(renderer!.root, 'Restore purchases');
    await flushPromises();
  });

  expect(alert).not.toHaveBeenCalled();
  expect(mockRestorePurchases).toHaveBeenCalledWith('account_80');
  expect(mockCreateReconciliation).toHaveBeenCalledWith('restore', null);
  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase Reconciliation Pending',
    'Support Reference: SW-ABCD-EFGH',
  ]));
  expect(mockRouter.push).not.toHaveBeenCalled();
  alert.mockRestore();
});

it('shows active lifecycle and opens native subscription management through RevenueCat', async () => {
  mockIdentity = { accountId: 'account_80', isAccount: true };
  mockMembership = activeMembership('monthly');
  await renderScreen();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Active · Monthly',
    'Renews 8/29/2026',
    'Active Premium Membership',
    'Manage Subscription',
    'Stitch Coin Packs',
    'AI Credit Packs',
  ]));
  expect(allText(renderer!.root)).not.toContain('Premium Daily Coin Claim');
  expect(allText(renderer!.root)).not.toContain('Theme Collection');
  await act(async () => pressByText(renderer!.root, 'Manage Subscription'));
  expect(mockManageSubscriptions).toHaveBeenCalledTimes(1);
});

it('marks the Current Plan for an active member and blocks its own repurchase', async () => {
  mockIdentity = { accountId: 'account_current_plan', isAccount: true };
  mockMembership = activeMembership('monthly');
  await renderScreen();

  expect(allText(renderer!.root)).toContain('CURRENT PLAN');
  expect(allText(renderer!.root)).not.toContain('Choose Monthly');
  expect(renderer!.root.findByProps({ testID: 'premium-premium_monthly' }).props.disabled).toBe(true);
});

it('never preselects a different Premium Plan for an active member', async () => {
  mockIdentity = { accountId: 'account_no_preselect', isAccount: true };
  mockMembership = activeMembership('weekly');
  await renderScreen();

  const currentCard = renderer!.root.findByProps({ testID: 'premium-premium_weekly' });
  expect(StyleSheet.flatten(currentCard.props.style({ pressed: false }))).toMatchObject({
    borderColor: Theme.colors.accentRose,
  });
  expect(allText(renderer!.root)).not.toContain('Choose Annual');
  expect(allText(renderer!.root)).not.toContain('Choose Weekly');
});

it('classifies Weekly-to-Monthly, Weekly-to-Annual, and Monthly-to-Annual as upgrades on iOS', async () => {
  mockIdentity = { accountId: 'account_upgrade_classify', isAccount: true };
  mockMembership = activeMembership('weekly');
  await renderScreen();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining(['UPGRADE']));
  expect(allText(renderer!.root)).not.toContain('PLAN CHANGE');
});

it('classifies the reverse direction as a plan change on iOS', async () => {
  mockIdentity = { accountId: 'account_change_classify', isAccount: true };
  mockMembership = activeMembership('annual');
  await renderScreen();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining(['PLAN CHANGE']));
  expect(allText(renderer!.root)).not.toContain('UPGRADE');
});

it('opens an in-app upgrade confirmation showing the Current Plan, target price, billing period, and credit allowance', async () => {
  mockIdentity = { accountId: 'account_upgrade_confirm', isAccount: true };
  mockMembership = activeMembership('weekly');
  await renderScreen();

  await act(async () => {
    renderer!.root.findByProps({ testID: 'premium-premium_monthly' }).props.onPress();
  });

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('commerce_product_selected', {
    product_kind: 'premium_membership',
    product_key: 'premium_monthly',
  });
  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Confirm Premium upgrade',
    'Current Plan: Weekly',
    'Upgrade to Monthly · $7.99 every 1 month',
    '15 credits / paid month',
  ]));
  expect(allText(renderer!.root).join(' ')).toContain(
    'The App Store controls the final charge and effective date for this upgrade.',
  );
  expect(mockPurchasePackage).not.toHaveBeenCalled();
});

it('opens an in-app downgrade confirmation naming the deferred effect instead of routing to Manage Subscription (issue #125)', async () => {
  mockIdentity = { accountId: 'account_downgrade_confirm', isAccount: true };
  mockMembership = activeMembership('annual');
  await renderScreen();

  await act(async () => {
    renderer!.root.findByProps({ testID: 'premium-premium_weekly' }).props.onPress();
    await flushPromises();
  });

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Confirm Premium plan change',
    'Current Plan: Annual',
    'Change to Weekly · $2.99 every 1 week',
    'Confirm plan change',
  ]));
  expect(allText(renderer!.root).join(' ')).toContain(
    'The App Store defers this change to the end of your current period',
  );
  expect(allText(renderer!.root)).not.toContain('Confirm Premium upgrade');
  expect(mockManageSubscriptions).not.toHaveBeenCalled();
  expect(mockPurchasePackage).not.toHaveBeenCalled();
});

it('reports subscription_change_cancelled when the downgrade confirmation is dismissed (issue #125)', async () => {
  mockIdentity = { accountId: 'account_downgrade_dismiss', isAccount: true };
  mockMembership = activeMembership('annual');
  await renderScreen();

  await act(async () => {
    renderer!.root.findByProps({ testID: 'premium-premium_weekly' }).props.onPress();
    await flushPromises();
  });
  await act(async () => {
    pressByText(renderer!.root, 'Cancel');
    await flushPromises();
  });

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('subscription_change_cancelled', {
    source_plan: 'premium_annual',
    target_plan: 'premium_weekly',
    platform: 'ios',
  });
  expect(allText(renderer!.root)).not.toContain('Confirm Premium plan change');
  expect(mockPurchasePackage).not.toHaveBeenCalled();
});

it('verifies a confirmed downgrade against the Scheduled Plan Change and reports no grant yet (issue #125)', async () => {
  mockIdentity = { accountId: 'account_downgrade_flow', isAccount: true };
  mockMembership = activeMembership('annual');
  mockPurchasePackage.mockResolvedValue({});
  mockFetchMembership
    .mockResolvedValueOnce(activeMembership('annual'))
    .mockResolvedValue(activeMembership('annual', 'active', {
      targetPlan: 'weekly',
      effectiveAt: '2026-09-15T00:00:00Z',
    }));
  await renderScreen();

  await act(async () => {
    renderer!.root.findByProps({ testID: 'premium-premium_weekly' }).props.onPress();
  });
  await act(async () => {
    pressByText(renderer!.root, 'Confirm plan change');
    await flushPromises();
  });
  await act(async () => {
    renderer!.root
      .findByProps({ testID: 'plan-change-confirmation-modal' })
      .props.onDismiss();
    await flushPromises();
  });

  expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('subscription_change_started', {
    source_plan: 'premium_annual',
    target_plan: 'premium_weekly',
    platform: 'ios',
  });
  expect(allText(renderer!.root)).toContain('Plan change scheduled');
  expect(allText(renderer!.root)).toContain(
    `Premium changes to Weekly on ${new Date('2026-09-15T00:00:00Z').toLocaleDateString()}.`,
  );
  // Nothing is granted until the change activates, so neither completion event
  // fires here: the Game Backend reports the activation at the next renewal.
  expect(capturedEventKinds()).not.toContain('purchase_completed');
  expect(mockCaptureGameplayEvent).not.toHaveBeenCalledWith(
    'subscription_change_completed', expect.anything(),
  );
});

it('shows the scheduled downgrade target and effective date while the Current Plan stays active (issue #124)', async () => {
  mockIdentity = { accountId: 'account_scheduled_change', isAccount: true };
  mockMembership = activeMembership('annual', 'active', {
    targetPlan: 'weekly',
    effectiveAt: '2026-09-15T00:00:00Z',
  });
  await renderScreen();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    `Changes to Weekly on ${new Date('2026-09-15T00:00:00Z').toLocaleDateString()}`,
  ]));
  expect(allText(renderer!.root)).toContain('CURRENT PLAN');
});

it('leaves an activated scheduled downgrade to the Game Backend instead of reporting it per device (issue #126)', async () => {
  mockIdentity = { accountId: 'account_scheduled_complete', isAccount: true };
  mockMembership = activeMembership('annual', 'active', {
    targetPlan: 'weekly',
    effectiveAt: '2026-09-15T00:00:00Z',
  });
  await renderScreen();

  await act(async () => {
    mockMembership = activeMembership('weekly');
    renderer!.update(React.createElement(CommerceScreen));
    await flushPromises();
  });

  // Every signed-in device observes this same activation, and a player who
  // never opens the store observes none, so the screen reports nothing.
  expect(mockCaptureGameplayEvent).not.toHaveBeenCalledWith(
    'subscription_change_completed', expect.anything(),
  );
});

it('completes a direct iOS upgrade through the ordinary purchase and reconciliation path with subscription_change analytics', async () => {
  mockIdentity = { accountId: 'account_upgrade_flow', isAccount: true };
  mockMembership = activeMembership('weekly');
  mockPurchasePackage.mockResolvedValue({});
  mockFetchMembership
    .mockResolvedValueOnce(activeMembership('weekly'))
    .mockResolvedValue(activeMembership('monthly'));
  await renderScreen();

  await act(async () => {
    renderer!.root.findByProps({ testID: 'premium-premium_monthly' }).props.onPress();
  });
  await act(async () => {
    pressByText(renderer!.root, 'Confirm upgrade');
    await flushPromises();
  });
  await act(async () => {
    renderer!.root
      .findByProps({ testID: 'plan-change-confirmation-modal' })
      .props.onDismiss();
    await flushPromises();
  });

  expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_started', {
    product_kind: 'premium_membership',
    product_key: 'premium_monthly',
  });
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('subscription_change_started', {
    source_plan: 'premium_weekly',
    target_plan: 'premium_monthly',
    platform: 'ios',
  });
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith(
    'purchase_completed',
    { product_kind: 'premium_membership', product_key: 'premium_monthly' },
    undefined,
    { currency: 'USD', value: 7.99 },
  );
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('subscription_change_completed', {
    source_plan: 'premium_weekly',
    target_plan: 'premium_monthly',
    platform: 'ios',
  });
});

it('treats an upgrade store cancellation as a non-error and reports subscription_change_cancelled', async () => {
  mockIdentity = { accountId: 'account_upgrade_cancel', isAccount: true };
  mockMembership = activeMembership('weekly');
  mockPurchasePackage.mockRejectedValue({ userCancelled: true });
  await renderScreen();

  await act(async () => {
    renderer!.root.findByProps({ testID: 'premium-premium_monthly' }).props.onPress();
  });
  await act(async () => {
    pressByText(renderer!.root, 'Confirm upgrade');
    await flushPromises();
  });
  await act(async () => {
    renderer!.root
      .findByProps({ testID: 'plan-change-confirmation-modal' })
      .props.onDismiss();
    await flushPromises();
  });

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_cancelled', {
    product_kind: 'premium_membership',
    product_key: 'premium_monthly',
  });
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('subscription_change_cancelled', {
    source_plan: 'premium_weekly',
    target_plan: 'premium_monthly',
    platform: 'ios',
  });
  // Cancellation preserves the Current Plan: no failure surfaces and Weekly
  // remains selected, not the plan the player backed out of.
  expect(allText(renderer!.root)).not.toContain('Purchase failed');
});

it('reports a genuine upgrade store failure with subscription_change_failed at the store stage', async () => {
  mockIdentity = { accountId: 'account_upgrade_store_fail', isAccount: true };
  mockMembership = activeMembership('weekly');
  mockPurchasePackage.mockRejectedValue(new Error('store unavailable'));
  await renderScreen();

  await act(async () => {
    renderer!.root.findByProps({ testID: 'premium-premium_monthly' }).props.onPress();
  });
  await act(async () => {
    pressByText(renderer!.root, 'Confirm upgrade');
    await flushPromises();
  });
  await act(async () => {
    renderer!.root
      .findByProps({ testID: 'plan-change-confirmation-modal' })
      .props.onDismiss();
    await flushPromises();
  });

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('subscription_change_failed', {
    source_plan: 'premium_weekly',
    target_plan: 'premium_monthly',
    platform: 'ios',
    failure_stage: 'store',
  });
  expect(allText(renderer!.root)).toContain('Purchase failed');
});

it.each([
  ['grace' as const],
  ['billing_retry' as const],
  ['paused' as const],
  ['cancelled' as const],
])('keeps the Current Plan identified but exposes no plan action for %s', async (lifecycle) => {
  mockIdentity = { accountId: 'account_restricted', isAccount: true };
  mockMembership = activeMembership('monthly', lifecycle);
  await renderScreen();

  expect(allText(renderer!.root)).toContain('Manage Subscription');
  expect(allText(renderer!.root)).toContain('Your Premium plan');
  expect(allText(renderer!.root)).toContain('CURRENT PLAN');
  expect(allText(renderer!.root)).not.toContain('Choose a Premium plan');
  expect(allText(renderer!.root)).not.toContain('Choose Annual');
  expect(allText(renderer!.root)).not.toContain('UPGRADE');
  expect(allText(renderer!.root)).not.toContain('PLAN CHANGE');
  for (const productKey of ['premium_weekly', 'premium_monthly', 'premium_annual']) {
    expect(renderer!.root.findByProps({ testID: `premium-${productKey}` }).props.disabled).toBe(true);
  }
});

it.each([
  ['expired' as const],
  ['refunded' as const],
])('retains the ordinary new-plan purchase journey for an inactive %s membership', async (lifecycle) => {
  mockIdentity = { accountId: 'account_inactive_lifecycle', isAccount: true };
  mockMembership = inactiveLifecycleMembership('monthly', lifecycle);
  await renderScreen();

  expect(allText(renderer!.root)).toContain('Choose Annual');
  expect(allText(renderer!.root)).not.toContain('Manage Subscription');
  expect(allText(renderer!.root)).not.toContain('CURRENT PLAN');
});

it('hides the direct plan-change action on Android while still marking the Current Plan', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  try {
    mockIdentity = { accountId: 'account_android_member', isAccount: true };
    mockMembership = activeMembership('weekly');
    await renderScreen();

    expect(allText(renderer!.root)).toContain('CURRENT PLAN');
    expect(allText(renderer!.root)).not.toContain('UPGRADE');
    expect(allText(renderer!.root)).not.toContain('PLAN CHANGE');
    expect(allText(renderer!.root)).toContain('Manage Subscription');
    expect(renderer!.root.findByProps({ testID: 'premium-premium_monthly' }).props.disabled).toBe(true);
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  }
});

it('gives an iOS Guest Player with Premium the same Current Plan and Manage Subscription controls as a Registered Account', async () => {
  mockIdentity = { accountId: null, isAccount: false };
  mockMembership = activeMembership('annual');
  await renderScreen();

  expect(allText(renderer!.root)).toContain('Manage Subscription');
  expect(allText(renderer!.root)).toContain('CURRENT PLAN');
  expect(allText(renderer!.root)).not.toContain('Choose Annual');
});

it('disables direct change and preserves Manage Subscription when the Current Plan cannot be mapped to the catalog', async () => {
  mockIdentity = { accountId: 'account_unmapped', isAccount: true };
  mockMembership = activeMembership('weekly');
  withholdProducts(['premium_weekly']);
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await renderScreen();

  expect(allText(renderer!.root)).toContain('Manage Subscription');
  expect(allText(renderer!.root)).not.toContain('Choose a Premium plan');
  expect(allText(renderer!.root)).not.toContain('Your Premium plan');
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith(
    'commerce_catalog_incomplete',
    { product_kind: 'premium_membership', product_key: 'premium_weekly' },
    'commerce_catalog_incomplete:com.avk.stitchwish.premium_weekly',
  );
  warning.mockRestore();
});

it('records the Premium benefit context when a locked benefit opens the store', async () => {
  mockParams = { category: 'premium', source: 'premium_benefit' };
  await renderScreen();

  expect(allText(renderer!.root)).toContain('Choose a Premium plan');
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('commerce_store_viewed', {
    source: 'premium_benefit',
  });
});

afterEach(() => {
  jest.useRealTimers();
  if (renderer !== null) {
    act(() => renderer?.unmount());
    renderer = null;
  }
});

it('keeps Guest catalog intent and makes Continue as Guest primary', async () => {
  await act(async () => {
    renderer = TestRenderer.create(<CommerceScreen />);
    await flushPromises();
  });

  expect(allText(renderer!.root)).toContain('Commerce Store');
  expect(allText(renderer!.root)).toContain('$39.99');
  expect(allText(renderer!.root)).toContain('From $1.99');

  await act(async () => {
    pressAncestor(renderer!.root.findByProps({ testID: 'open-stitch-coin-packs' }));
  });
  expect(allText(renderer!.root)).toContain('$1.99');
  expect(allText(renderer!.root)).toContain('$4.99');
  expect(allText(renderer!.root)).toContain('$9.99');

  await act(async () => {
    pressByText(renderer!.root, 'Buy');
    await flushPromises();
  });

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('commerce_product_selected', {
    product_kind: 'stitch_coin_pack',
    product_key: 'coin_pack_300',
  });
  expect(allText(renderer!.root)).toContain('Continue as Guest');
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(useCommerceIntentStore.getState().intent).toEqual({
    category: 'stitch_coin',
    entrySource: 'profile',
    productKey: 'coin_pack_300',
    productKind: 'stitch_coin_pack',
  });
  expect(mockPurchasePackage).not.toHaveBeenCalled();

  mockIdentity = { accountId: 'account_79', isAccount: true };
  mockParams = { source: 'sign_in_return' };
  await act(async () => {
    renderer!.update(<CommerceScreen />);
    await flushPromises();
  });

  expect(allText(renderer!.root)).toContain(
    'You’re signed in. 300 Stitch Coins is still selected. Review it and tap Buy when ready.',
  );
  expect(allText(renderer!.root)).toContain('Selected before sign-in');
  expect(mockPurchasePackage).not.toHaveBeenCalled();
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('commerce_store_viewed', {
    source: 'sign_in_return',
  });
});

it('shows a Guest their real AI Credit wallet balance instead of a hardcoded 0', async () => {
  // A Guest can buy AI Credit packs and the balance is granted to their Guest
  // Ledger server-side (economy-read.service.ts resolves both principal
  // types identically); the wallet must not lie about it (Guideline 2.1(a)).
  mockAiCreditWalletBalance = 1234;
  await renderScreen();

  expect(allText(renderer!.root)).toContain('1,234');
  expect(allText(renderer!.root)).not.toContain('0');
});

it('closes the pack sheet before routing a Guest to sign-in so the destination is reachable', async () => {
  // iOS never presents a routed screen over an already-presented Modal, so
  // leaving the pack sheet's <Modal> open when navigating to sign-in makes the
  // sign-in screen render unreachable behind it (App Review Guideline 2.1(a)).
  await renderScreen();
  await openCoinPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));

  expect(visibleModalCount(renderer!.root)).toBe(1);
  expect(allText(renderer!.root)).toContain('Sign in instead');

  await act(async () => pressByText(renderer!.root, 'Sign in instead'));

  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/(tabs)/(settings)/sign-in',
    params: { returnTo: 'commerce' },
  });
  expect(visibleModalCount(renderer!.root)).toBe(0);
  expect(allText(renderer!.root)).not.toContain('Sign in instead');
});

it('drives the Guest purchase through mapping, durable attempt, verification and refreshed balance', async () => {
  await renderScreen();
  await openCoinPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  await act(async () => pressByText(renderer!.root, 'Continue as Guest'));
  await act(async () => {
    pressByText(renderer!.root, 'Confirm 300 Stitch Coins');
    await flushPromises();
  });

  expect(mockMapGuestRevenueCatSubscriber).toHaveBeenCalledWith('anonymous-subscriber');
  expect(mockCreateGuestPurchaseAttempt).toHaveBeenCalledWith(
    'com.avk.stitchwish.coin_pack_300', expect.any(String), 'anonymous-subscriber',
  );
  expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
  expect(mockFetchGuestPurchaseAttempt).toHaveBeenCalledWith('guest-attempt-81');
  expect(mockFetchCoinBalance).toHaveBeenCalledWith();
  expect(allText(renderer!.root)).toContain('300 Stitch Coins grant verified. Stitch Coin balance: 420.');
});

it('claims the rotated anonymous subscriber when RevenueCat re-identifies during the purchase', async () => {
  // RevenueCat rotates the anonymous identifier on sign-out and reports the
  // purchase under whichever identifier is current, so the Game Backend mapping
  // has to follow it or the store webhook resolves to nobody.
  mockPrepareGuestSubscriber.mockResolvedValue('anonymous-subscriber');
  mockGetSubscriberId.mockResolvedValue('rotated-subscriber');

  await renderScreen();
  await openCoinPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  await act(async () => pressByText(renderer!.root, 'Continue as Guest'));
  await act(async () => {
    pressByText(renderer!.root, 'Confirm 300 Stitch Coins');
    await flushPromises();
  });

  expect(mockMapGuestRevenueCatSubscriber).toHaveBeenNthCalledWith(1, 'anonymous-subscriber');
  expect(mockMapGuestRevenueCatSubscriber).toHaveBeenNthCalledWith(2, 'rotated-subscriber');
});

it('shows a Guest Player the Support Reference when Coin Pack reconciliation fails', async () => {
  mockFetchGuestPurchaseAttempt.mockResolvedValue({ status: 'failed', balance: null });
  await renderScreen();
  await openCoinPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  await act(async () => pressByText(renderer!.root, 'Continue as Guest'));
  await act(async () => {
    pressByText(renderer!.root, 'Confirm 300 Stitch Coins');
    await flushPromises();
  });
  await dismissProductSheet();

  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase failed',
    'The store transaction did not match this Coin Pack. Retry verification or contact support; do not buy it again.',
    'Support Reference: SW-GUEST-COIN',
  ]));
});

it('opens current Coin Pack prices directly for a Stitch Coin shortfall', async () => {
  mockParams = { category: 'stitch_coin', source: 'stitch_coin_shortfall' };
  await renderScreen();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Stitch Coin Packs',
    '300 Stitch Coins',
    '$1.99',
    '900 Stitch Coins',
    '$4.99',
    '2,000 Stitch Coins',
    '$9.99',
  ]));
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('commerce_store_viewed', {
    source: 'stitch_coin_shortfall',
  });
});

it('opens the same Coin Packs context from a direct deep link', async () => {
  mockParams = { category: 'stitch_coin', source: 'direct' };
  await renderScreen();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Stitch Coin Packs',
    '300 Stitch Coins',
    '$1.99',
  ]));
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('commerce_store_viewed', {
    source: 'direct',
  });
});

it('opens current AI Credit Pack prices from Profile, direct links, and AI Credit shortfall', async () => {
  for (const params of [
    { category: 'ai_credit', source: 'profile' },
    { category: 'ai_credit', source: 'direct' },
    { category: 'ai_credit', source: 'ai_credit_shortfall' },
  ]) {
    mockParams = params;
    await renderScreen();

    expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
      'AI Credit Packs',
      '5 AI Credits',
      '$2.99',
      '20 AI Credits',
      '$9.99',
      '50 AI Credits',
      '$19.99',
    ]));
    expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('commerce_store_viewed', {
      source: params.source,
    });
    act(() => renderer?.unmount());
    renderer = null;
    mockCaptureGameplayEvent.mockClear();
  }
});

it('preserves Guest AI Credit Pack selection through Guest confirmation', async () => {
  await renderScreen();
  await openAiCreditPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));

  expect(useCommerceIntentStore.getState().intent).toEqual({
    category: 'ai_credit',
    entrySource: 'profile',
    productKey: 'ai_credit_pack_5',
    productKind: 'ai_credit_pack',
  });
  expect(allText(renderer!.root)).toContain('Continue as Guest');
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockPurchasePackage).not.toHaveBeenCalled();
  await act(async () => {
    pressByText(renderer!.root, 'Continue as Guest');
    await flushPromises();
  });
  expect(allText(renderer!.root)).toContain('Confirm AI Credit purchase');
  expect(mockPurchasePackage).not.toHaveBeenCalled();
});

it('keeps an exact AI Credit Pack intent pending and blocks repeat purchase', async () => {
  mockIdentity = { accountId: 'account_82', isAccount: true };
  await renderScreen();
  await confirmSmallAiCreditPackPurchase();

  expect(mockCreateAiCreditPackReconciliation).toHaveBeenCalledWith(
    'ai_credit_pack_5',
    'store-transaction-81',
  );
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('commerce_product_selected', {
    product_kind: 'ai_credit_pack',
    product_key: 'ai_credit_pack_5',
  });
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_started', {
    product_kind: 'ai_credit_pack',
    product_key: 'ai_credit_pack_5',
  });
  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase Reconciliation Pending',
    'Support Reference: SW-AI-CREDIT',
  ]));
  expect(capturedEventKinds()).not.toContain('purchase_completed');

  await openAiCreditPacks();
  expect(pressableByText(renderer!.root, 'Buy').props.disabled).toBe(true);
  expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
});

it('treats AI Credit Pack cancellation as non-error without reconciliation', async () => {
  mockIdentity = { accountId: 'account_82', isAccount: true };
  mockPurchasePackage.mockRejectedValue({ userCancelled: true });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await renderScreen();
  await confirmSmallAiCreditPackPurchase();

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_cancelled', {
    product_kind: 'ai_credit_pack',
    product_key: 'ai_credit_pack_5',
  });
  expect(mockCreateAiCreditPackReconciliation).not.toHaveBeenCalled();
  expect(allText(renderer!.root)).not.toContain('Purchase Reconciliation Pending');
  expect(resultModalVisible(renderer!.root)).toBe(false);
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
});

it('reports an AI Credit Pack store failure without starting reconciliation', async () => {
  mockIdentity = { accountId: 'account_82', isAccount: true };
  mockPurchasePackage.mockRejectedValue({
    code: '42',
    message: 'Purchase failure simulated successfully in Test Store.',
    userCancelled: false,
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await renderScreen();
  await confirmSmallAiCreditPackPurchase();

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_failed', {
    product_kind: 'ai_credit_pack',
    product_key: 'ai_credit_pack_5',
    failure_stage: 'store',
  });
  expect(mockCreateAiCreditPackReconciliation).not.toHaveBeenCalled();
  const expectedMessage =
    'The test purchase was declined. No payment was made. Choose a different Test Store result in Settings, then try again.';
  expect(allText(renderer!.root)).toContain(expectedMessage);
  // The pack sheet closed and the in-game result modal replaced the native
  // alert, so the failure is the only thing presented.
  expect(allText(renderer!.root)).not.toContain('Buy');
  expect(visibleModalCount(renderer!.root)).toBe(1);
  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase failed',
    expectedMessage,
  ]));
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
});

it.each([
  ['verification_failed', 'verification', 'The store transaction did not match this AI Credit Pack.'],
  ['grant_failed', 'grant', 'The purchase was verified, but the AI Credit grant is unavailable.'],
] as const)('reports AI Credit %s at the correct stage', async (status, stage, message) => {
  mockIdentity = { accountId: 'account_82', isAccount: true };
  mockFetchAiCreditPackReconciliation.mockResolvedValue({ status, balance: null });
  await renderScreen();
  await confirmSmallAiCreditPackPurchase();

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_failed', {
    product_kind: 'ai_credit_pack',
    product_key: 'ai_credit_pack_5',
    failure_stage: stage,
  });
  expect(allText(renderer!.root).join(' ')).toContain(message);
  expect(allText(renderer!.root)).toContain('Retry reconciliation');
  expect(resultModalText(renderer!.root).join(' ')).not.toContain('Verifying your purchase now');
  expect(resultModalText(renderer!.root)).toContain('Purchase failed');
  expect(resultModalText(renderer!.root).join(' ')).toContain(message);
});

it('updates AI Credit balance and completes only after the exact backend grant', async () => {
  mockIdentity = { accountId: 'account_82', isAccount: true };
  mockFetchAiCreditPackReconciliation.mockResolvedValue({ status: 'granted', balance: 9 });
  mockFetchAiCreditBalance.mockResolvedValue(9);
  await renderScreen();
  await confirmSmallAiCreditPackPurchase();

  expect(mockFetchAiCreditBalance).toHaveBeenCalledTimes(1);
  expect(mockSetQueryData).toHaveBeenCalledWith(['economy', 'aiCreditBalance'], 9);
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith(
    'purchase_completed',
    { product_kind: 'ai_credit_pack', product_key: 'ai_credit_pack_5' },
    undefined,
    { currency: 'USD', value: 2.99 },
  );
  expect(allText(renderer!.root)).toContain(
    '5 AI Credits grant verified. AI Credit balance: 9.',
  );
});

it('carries the purchase result modal from pending to a verified AI Credit Pack grant', async () => {
  mockIdentity = { accountId: 'account_ai_modal', isAccount: true };
  let resolveReconciliation: (value: { status: string; balance: number | null }) => void = () => undefined;
  mockFetchAiCreditPackReconciliation.mockReturnValue(
    new Promise((resolve) => { resolveReconciliation = resolve; }),
  );
  await renderScreen();
  await openAiCreditPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  await act(async () => {
    pressByText(renderer!.root, 'Confirm 5 AI Credits');
    await flushPromises();
  });

  // iOS still owns the dismissed native sheet until onDismiss. Presenting the
  // result modal before that callback makes it disappear and leaves touches
  // captured by the stale sheet.
  expect(allText(renderer!.root)).not.toContain('Buy');
  expect(resultModalVisible(renderer!.root)).toBe(false);
  await dismissProductSheet();
  expect(visibleModalCount(renderer!.root)).toBe(1);
  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase received',
    'The store accepted 5 AI Credits. Verifying your purchase now.',
  ]));

  await act(async () => {
    resolveReconciliation({ status: 'granted', balance: 9 });
    await flushPromises();
  });

  expect(visibleModalCount(renderer!.root)).toBe(1);
  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'AI Credits granted',
    '5 AI Credits have been added to your balance.',
  ]));
});

it('offers Retry after a delayed AI Credit grant without another store purchase', async () => {
  mockIdentity = { accountId: 'account_82', isAccount: true };
  await renderScreen();
  await openAiCreditPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  const now = jest.spyOn(Date, 'now')
    .mockReturnValueOnce(1_000)
    .mockReturnValueOnce(1_000)
    .mockReturnValue(12_000);
  await act(async () => {
    pressByText(renderer!.root, 'Confirm 5 AI Credits');
    await flushPromises();
  });
  await dismissProductSheet();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase Reconciliation Pending',
    'Retry reconciliation',
    'Support Reference: SW-AI-CREDIT',
  ]));
  expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
  // A prolonged wait is not a failure: the modal moves to the informational
  // variant, offering no retry of its own.
  expect(resultModalVisible(renderer!.root)).toBe(true);
  const modalText = resultModalText(renderer!.root);
  expect(modalText).toEqual(expect.arrayContaining([
    'Still verifying',
    'Verification is still under way. Your AI Credit balance will update once it completes.',
  ]));
  expect(modalText.join(' ').toLowerCase()).not.toContain('fail');
  now.mockRestore();
});

it('never stacks the pack confirmation in a second Modal over the open product sheet', async () => {
  // iOS silently refuses to present a modal over an already presented one, so a
  // nested confirmation Modal makes Buy look unresponsive.
  mockIdentity = { accountId: 'account_81', isAccount: true };
  await renderScreen();

  await openCoinPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  expect(allText(renderer!.root)).toContain('Confirm Stitch Coin purchase');
  expect(visibleModalCount(renderer!.root)).toBe(1);
  expect(
    renderer!.root.findByProps({ testID: 'coin-pack-confirmation' })
      .findAllByType(Modal),
  ).toHaveLength(0);

  await act(async () => pressByText(renderer!.root, 'Cancel'));
  await openAiCreditPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  expect(allText(renderer!.root)).toContain('Confirm AI Credit purchase');
  expect(visibleModalCount(renderer!.root)).toBe(1);
  expect(
    renderer!.root.findByProps({ testID: 'ai-credit-pack-confirmation' })
      .findAllByType(Modal),
  ).toHaveLength(0);
});

it('slides only the product sheet while fading the backdrop independently', async () => {
  await renderScreen();
  await openCoinPacks();

  const modal = renderer!.root.findByProps({ testID: 'product-sheet-modal' });
  expect(modal.props.animationType).toBe('none');
  expect(renderer!.root.findByProps({ testID: 'product-sheet-backdrop' }).props.style)
    .toEqual(expect.arrayContaining([expect.objectContaining({ opacity: expect.anything() })]));
  expect(renderer!.root.findByProps({ testID: 'product-sheet-panel' }).props.style)
    .toEqual(expect.arrayContaining([expect.objectContaining({ transform: expect.any(Array) })]));
});

it('requires explicit Coin Pack confirmation and treats cancellation as a non-error', async () => {
  mockIdentity = { accountId: 'account_81', isAccount: true };
  mockPurchasePackage.mockRejectedValue({ userCancelled: true });
  await renderScreen();
  await openCoinPacks();

  await act(async () => pressByText(renderer!.root, 'Buy'));
  expect(allText(renderer!.root)).toContain('Confirm Stitch Coin purchase');
  expect(mockPurchasePackage).not.toHaveBeenCalled();

  await act(async () => {
    pressByText(renderer!.root, 'Confirm 300 Stitch Coins');
    await flushPromises();
  });

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('commerce_product_selected', {
    product_kind: 'stitch_coin_pack',
    product_key: 'coin_pack_300',
  });
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_started', {
    product_kind: 'stitch_coin_pack',
    product_key: 'coin_pack_300',
  });
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_cancelled', {
    product_kind: 'stitch_coin_pack',
    product_key: 'coin_pack_300',
  });
  expect(mockCreateCoinPackReconciliation).not.toHaveBeenCalled();
  expect(allText(renderer!.root)).not.toContain('Purchase Reconciliation Pending');
});

it('keeps the exact Coin Pack intent pending with Support Reference and blocks repurchase', async () => {
  mockIdentity = { accountId: 'account_81', isAccount: true };
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await renderScreen();
  await confirmSmallCoinPackPurchase();

  expect(mockCreateCoinPackReconciliation).toHaveBeenCalledWith(
    'coin_pack_300',
    'store-transaction-81',
  );
  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase Reconciliation Pending',
    'Support Reference: SW-COIN-PACK',
  ]));
  expect(capturedEventKinds()).not.toContain('purchase_completed');

  await act(async () => pressAncestor(renderer!.root.findByProps({ testID: 'open-stitch-coin-packs' })));
  expect(pressableByText(renderer!.root, 'Buy').props.disabled).toBe(true);
  expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
  // Store acceptance replaced the native alert with the in-game result modal.
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
});

it('reports a Coin Pack store failure without starting backend reconciliation', async () => {
  mockIdentity = { accountId: 'account_81', isAccount: true };
  mockPurchasePackage.mockRejectedValue(new Error('store unavailable'));
  await renderScreen();
  await confirmSmallCoinPackPurchase();

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_failed', {
    product_kind: 'stitch_coin_pack',
    product_key: 'coin_pack_300',
    failure_stage: 'store',
  });
  expect(mockCreateCoinPackReconciliation).not.toHaveBeenCalled();
  expect(allText(renderer!.root)).toContain('store unavailable');
  expect(allText(renderer!.root)).not.toContain('Buy');
  expect(visibleModalCount(renderer!.root)).toBe(1);
  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase failed',
    'store unavailable',
  ]));
  // Retry lives only on the page-level banner, which outlives the modal.
  expect(resultModalText(renderer!.root)).not.toContain('Retry reconciliation');

  await act(async () => pressByText(renderer!.root, 'Close'));

  expect(resultModalVisible(renderer!.root)).toBe(false);
  expect(allText(renderer!.root)).toContain('store unavailable');
});

it('keeps an exact-product verification mismatch pending without encouraging repurchase', async () => {
  mockIdentity = { accountId: 'account_81', isAccount: true };
  mockFetchCoinPackReconciliation.mockResolvedValue({
    status: 'verification_failed',
    balance: null,
  });
  await renderScreen();
  await confirmSmallCoinPackPurchase();

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_failed', {
    product_kind: 'stitch_coin_pack',
    product_key: 'coin_pack_300',
    failure_stage: 'verification',
  });
  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase Reconciliation Pending',
    'Retry reconciliation',
    'The store transaction did not match this Coin Pack. Retry verification or contact support; do not buy it again.',
  ]));
  // The pending modal opened at store acceptance must not still claim
  // verification is under way once the backend has reported a mismatch.
  expect(resultModalText(renderer!.root).join(' ')).not.toContain('Verifying your purchase now');
  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase failed',
    'The store transaction did not match this Coin Pack. Retry verification or contact support; do not buy it again.',
  ]));
});

it('reports a verified transaction with a missing Coin grant at the grant stage', async () => {
  mockIdentity = { accountId: 'account_81', isAccount: true };
  mockFetchCoinPackReconciliation.mockResolvedValue({ status: 'grant_failed', balance: null });
  await renderScreen();
  await confirmSmallCoinPackPurchase();

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_failed', {
    product_kind: 'stitch_coin_pack',
    product_key: 'coin_pack_300',
    failure_stage: 'grant',
  });
  expect(mockFetchCoinBalance).not.toHaveBeenCalled();
  expect(allText(renderer!.root)).toContain(
    'The purchase was verified, but the Stitch Coin grant is unavailable. Retry reconciliation; do not buy it again.',
  );
  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase failed',
    'The purchase was verified, but the Stitch Coin grant is unavailable. Retry reconciliation; do not buy it again.',
  ]));
});

it('updates the wallet and emits completion only after the matching backend Coin grant', async () => {
  mockIdentity = { accountId: 'account_81', isAccount: true };
  mockFetchCoinPackReconciliation.mockResolvedValue({ status: 'granted', balance: 420 });
  mockFetchCoinBalance.mockResolvedValue(420);
  await renderScreen();
  await confirmSmallCoinPackPurchase();

  expect(mockFetchCoinBalance).toHaveBeenCalledTimes(1);
  expect(mockSetQueryData).toHaveBeenCalledWith(['economy', 'balance'], 420);
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith(
    'purchase_completed',
    { product_kind: 'stitch_coin_pack', product_key: 'coin_pack_300' },
    undefined,
    { currency: 'USD', value: 1.99 },
  );
  expect(allText(renderer!.root)).toContain(
    '300 Stitch Coins grant verified. Stitch Coin balance: 420.',
  );
  expect(allText(renderer!.root)).not.toContain('Purchase Reconciliation Pending');
});

it('carries the purchase result modal from pending to a verified Coin Pack grant', async () => {
  mockIdentity = { accountId: 'account_coin_modal', isAccount: true };
  let resolveReconciliation: (value: { status: string; balance: number | null }) => void = () => undefined;
  mockFetchCoinPackReconciliation.mockReturnValue(
    new Promise((resolve) => { resolveReconciliation = resolve; }),
  );
  await renderScreen();
  await openCoinPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  await act(async () => {
    pressByText(renderer!.root, 'Confirm 300 Stitch Coins');
    await flushPromises();
  });
  await dismissProductSheet();

  // The pending modal opens only after native dismissal completes.
  expect(allText(renderer!.root)).not.toContain('Buy');
  expect(visibleModalCount(renderer!.root)).toBe(1);
  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase received',
    'The store accepted 300 Stitch Coins. Verifying your purchase now.',
  ]));

  await act(async () => {
    resolveReconciliation({ status: 'granted', balance: 420 });
    await flushPromises();
  });

  expect(visibleModalCount(renderer!.root)).toBe(1);
  expect(resultModalText(renderer!.root)).toEqual(expect.arrayContaining([
    'Stitch Coins granted',
    '300 Stitch Coins have been added to your balance.',
  ]));
});

it('lets the pending modal be dismissed without stopping Coin Pack reconciliation', async () => {
  mockIdentity = { accountId: 'account_coin_dismiss', isAccount: true };
  let resolveReconciliation: (value: { status: string; balance: number | null }) => void = () => undefined;
  mockFetchCoinPackReconciliation.mockReturnValue(
    new Promise((resolve) => { resolveReconciliation = resolve; }),
  );
  await renderScreen();
  await openCoinPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  await act(async () => {
    pressByText(renderer!.root, 'Confirm 300 Stitch Coins');
    await flushPromises();
  });
  await dismissProductSheet();

  expect(resultModalVisible(renderer!.root)).toBe(true);

  await act(async () => pressByText(renderer!.root, 'Got it'));

  expect(resultModalVisible(renderer!.root)).toBe(false);

  await act(async () => {
    resolveReconciliation({ status: 'granted', balance: 420 });
    await flushPromises();
  });

  expect(allText(renderer!.root)).toContain(
    '300 Stitch Coins grant verified. Stitch Coin balance: 420.',
  );
});

it('keeps a delayed Coin grant pending and offers Retry without another store purchase', async () => {
  mockIdentity = { accountId: 'account_81', isAccount: true };
  await renderScreen();
  await openCoinPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  const now = jest.spyOn(Date, 'now')
    .mockReturnValueOnce(1_000)
    .mockReturnValueOnce(1_000)
    .mockReturnValue(12_000);
  await act(async () => {
    pressByText(renderer!.root, 'Confirm 300 Stitch Coins');
    await flushPromises();
  });
  await dismissProductSheet();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase Reconciliation Pending',
    'Retry reconciliation',
    'Support Reference: SW-COIN-PACK',
  ]));
  expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
  // A prolonged wait is not a failure: the modal moves to the informational
  // variant, offering no retry of its own.
  expect(resultModalVisible(renderer!.root)).toBe(true);
  const modalText = resultModalText(renderer!.root);
  expect(modalText).toEqual(expect.arrayContaining([
    'Still verifying',
    'Verification is still under way. Your Stitch Coin balance will update once it completes.',
  ]));
  expect(modalText.join(' ').toLowerCase()).not.toContain('fail');
  now.mockRestore();
});

it('keeps wallet and membership context visible while catalog Retry recovers', async () => {
  mockGetOfferings.mockRejectedValueOnce(new Error('offline'));
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await act(async () => {
    renderer = TestRenderer.create(<CommerceScreen />);
    await flushPromises();
  });

  const unavailableText = allText(renderer!.root);
  expect(unavailableText).toContain('Store temporarily unavailable');
  expect(unavailableText).toContain('120');
  expect(unavailableText).toContain('Browse plans as a Guest Player');

  mockGetOfferings.mockResolvedValueOnce(offering());
  await act(async () => {
    pressByText(renderer!.root, 'Retry');
    await flushPromises();
  });

  expect(allText(renderer!.root)).toContain('Stitch Coin Packs');
  expect(allText(renderer!.root)).not.toContain('Store temporarily unavailable');
  warning.mockRestore();
});

it('renders the products the store returned when canonical products are missing', async () => {
  withholdProducts(['premium_weekly', 'coin_pack_300']);
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await renderScreen();

  const text = allText(renderer!.root);
  expect(text).not.toContain('Store temporarily unavailable');
  expect(text).toEqual(expect.arrayContaining([
    'Annual',
    '$39.99',
    'Billed every 1 year',
    'Monthly',
    '$7.99',
    'Billed every 1 month',
    'Stitch Coin Packs',
    '900 · 2,000 Coins',
    'From $4.99',
    'AI Credit Packs',
    '5 · 20 · 50 Credits',
    'From $2.99',
  ]));
  expect(text).not.toContain('Weekly');
  expect(text).not.toContain('Billed every 1 week');
  warning.mockRestore();
});

it('reports missing canonical products as a warning and an analytics event', async () => {
  withholdProducts(['premium_weekly', 'coin_pack_300']);
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await renderScreen();

  expect(warning).toHaveBeenCalledWith(
    'Commerce Store catalog is missing canonical products: '
      + 'com.avk.stitchwish.premium_weekly, com.avk.stitchwish.coin_pack_300',
  );
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith(
    'commerce_catalog_incomplete',
    { product_kind: 'premium_membership', product_key: 'premium_weekly' },
    'commerce_catalog_incomplete:com.avk.stitchwish.premium_weekly',
  );
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith(
    'commerce_catalog_incomplete',
    { product_kind: 'stitch_coin_pack', product_key: 'coin_pack_300' },
    'commerce_catalog_incomplete:com.avk.stitchwish.coin_pack_300',
  );
  warning.mockRestore();
});

it.each([
  ['no current offering', { current: null }],
  ['a current offering that resolves to no products', { current: { availablePackages: [] } }],
])('keeps the unavailable state and its Retry for %s', async (_label, emptyOffering) => {
  mockGetOfferings.mockResolvedValue(emptyOffering);
  mockMissingCanonicalProducts.mockReturnValue(
    productRows.map(([key]) => `com.avk.stitchwish.${key}`),
  );
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await renderScreen();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Store temporarily unavailable',
    'Retry',
  ]));

  mockGetOfferings.mockResolvedValue(offering());
  mockMissingCanonicalProducts.mockReturnValue([]);
  await act(async () => {
    pressByText(renderer!.root, 'Retry');
    await flushPromises();
  });

  expect(allText(renderer!.root)).toContain('Stitch Coin Packs');
  expect(allText(renderer!.root)).not.toContain('Store temporarily unavailable');
  warning.mockRestore();
});

it('does not offer a pack category the store returned no packs for', async () => {
  mockParams = { category: 'ai_credit', source: 'ai_credit_shortfall' };
  withholdProducts(['ai_credit_pack_5', 'ai_credit_pack_20', 'ai_credit_pack_50']);
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await renderScreen();

  const text = allText(renderer!.root);
  expect(text).not.toContain('AI Credit Packs');
  expect(text).toEqual(expect.arrayContaining([
    'One-time packs',
    'Stitch Coin Packs',
    '300 · 900 · 2,000 Coins',
  ]));
  expect(renderer!.root.findAllByProps({ testID: 'open-ai-credit-packs' })).toHaveLength(0);
  expect(visibleModalCount(renderer!.root)).toBe(0);
  warning.mockRestore();
});

function subscriptionDisclosure(): ReactTestInstance {
  return renderer!.root.findByProps({ testID: 'commerce-subscription-disclosure' });
}

function resultModalVisible(root: ReactTestInstance): boolean {
  return root.findAllByProps({ testID: 'purchase-result-modal' }).length > 0;
}

function resultModalText(root: ReactTestInstance): string[] {
  const modals = root.findAllByProps({ testID: 'purchase-result-modal' });
  if (modals.length === 0) throw new Error('Missing purchase result modal');
  return allText(modals[0]!);
}

function visibleModalCount(root: ReactTestInstance): number {
  return root.findAllByType(Modal).filter((node) => node.props.visible === true).length;
}

function allText(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).flatMap((node) => textValue(node.props.children));
}

function textValue(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return [value.flatMap(textValue).join('')];
  return [];
}

function pressByText(root: ReactTestInstance, text: string): void {
  const label = root.findAllByType(Text).find((node) => textValue(node.props.children).includes(text));
  if (!label) throw new Error(`Missing text: ${text}`);
  pressAncestor(label);
}

function pressAncestor(node: ReactTestInstance): void {
  let current: ReactTestInstance | null = node;
  while (current && typeof current.props.onPress !== 'function') current = current.parent;
  if (!current) throw new Error('No pressable ancestor');
  current.props.onPress();
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// Keeps the withheld packages and the canonical identifiers the RevenueCat
// wrapper reports missing in step, so the two halves cannot drift apart.
function withholdProducts(productKeys: readonly string[]): void {
  mockGetOfferings.mockResolvedValue(offering(undefined, undefined, productKeys));
  mockMissingCanonicalProducts.mockReturnValue(
    productKeys.map((key) => `com.avk.stitchwish.${key}`),
  );
}

async function renderScreen(): Promise<void> {
  await act(async () => {
    renderer = TestRenderer.create(<CommerceScreen />);
    await flushPromises();
  });
}

async function confirmAnnualPurchase(): Promise<void> {
  await act(async () => pressByText(renderer!.root, 'Choose Annual'));
  await act(async () => {
    pressByText(renderer!.root, 'Confirm Annual');
    await flushPromises();
  });
  await dismissPremiumConfirmation();
}

async function dismissPremiumConfirmation(): Promise<void> {
  await act(async () => {
    renderer!.root
      .findByProps({ testID: 'premium-confirmation-modal' })
      .props.onDismiss();
    await flushPromises();
  });
}

async function openCoinPacks(): Promise<void> {
  await act(async () => {
    pressAncestor(renderer!.root.findByProps({ testID: 'open-stitch-coin-packs' }));
    renderer!.root.findByProps({ testID: 'product-sheet-modal' }).props.onShow();
  });
}

async function openAiCreditPacks(): Promise<void> {
  await act(async () => {
    pressAncestor(renderer!.root.findByProps({ testID: 'open-ai-credit-packs' }));
    renderer!.root.findByProps({ testID: 'product-sheet-modal' }).props.onShow();
  });
}

async function confirmSmallCoinPackPurchase(): Promise<void> {
  await openCoinPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  await act(async () => {
    pressByText(renderer!.root, 'Confirm 300 Stitch Coins');
    await flushPromises();
  });
  await dismissProductSheet();
}

async function confirmSmallAiCreditPackPurchase(): Promise<void> {
  await openAiCreditPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  await act(async () => {
    pressByText(renderer!.root, 'Confirm 5 AI Credits');
    await flushPromises();
  });
  await dismissProductSheet();
}

async function dismissProductSheet(): Promise<void> {
  await act(async () => {
    renderer!.root.findByProps({ testID: 'product-sheet-modal' }).props.onDismiss();
    await flushPromises();
  });
}

function pressableByText(root: ReactTestInstance, text: string): ReactTestInstance {
  const label = root.findAllByType(Text).find((node) => textValue(node.props.children).includes(text));
  if (!label) throw new Error(`Missing text: ${text}`);
  let current: ReactTestInstance | null = label;
  while (current && typeof current.props.onPress !== 'function') current = current.parent;
  if (!current) throw new Error('No pressable ancestor');
  return current;
}

function inactiveMembership() {
  return {
    active: false,
    plan: null,
    lifecycle: null,
    expiresAt: null,
    themeAccess: false,
    scheduledChange: null,
    dailyClaim: { claimed: false, coinsAvailable: 0, resetsAt: '2026-07-30T00:00:00Z' },
  };
}

function activeMembership(
  plan: 'weekly' | 'monthly' | 'annual',
  lifecycle: 'active' | 'trial' | 'grace' | 'billing_retry' | 'paused' | 'cancelled' = 'active',
  scheduledChange: { targetPlan: 'weekly' | 'monthly' | 'annual'; effectiveAt: string } | null = null,
) {
  return {
    active: true,
    plan,
    lifecycle,
    expiresAt: '2026-08-29T00:00:00Z',
    themeAccess: true,
    scheduledChange,
    dailyClaim: { claimed: false, coinsAvailable: 30, resetsAt: '2026-07-30T00:00:00Z' },
  };
}

function inactiveLifecycleMembership(plan: 'weekly' | 'monthly' | 'annual', lifecycle: 'expired' | 'refunded') {
  return {
    active: false,
    plan,
    lifecycle,
    expiresAt: '2026-08-29T00:00:00Z',
    themeAccess: false,
    scheduledChange: null,
    dailyClaim: { claimed: false, coinsAvailable: 0, resetsAt: '2026-07-30T00:00:00Z' },
  };
}
