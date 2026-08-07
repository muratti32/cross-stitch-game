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
import { useCommerceIntentStore } from '../commerceIntent';

let mockParams: { category?: string; source?: string } = { source: 'profile' };
let mockIdentity = { accountId: null as string | null, isAccount: false };
let mockMembership: Record<string, unknown> | undefined;

const mockRouter = {
  back: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};
const mockCaptureGameplayEvent = jest.fn().mockResolvedValue(undefined);
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
  useAiCreditBalance: () => ({ data: 4 }),
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

jest.mock('@/commerce/revenueCat', () => ({
  getRevenueCatOfferings: (...args: unknown[]) => mockGetOfferings(...args),
  isRevenueCatTrialEligible: (...args: unknown[]) => mockTrialEligible(...args),
  missingCanonicalRevenueCatProducts: (...args: unknown[]) =>
    mockMissingCanonicalProducts(...args),
  purchaseRevenueCatPackage: (...args: unknown[]) => mockPurchasePackage(...args),
  restoreRevenueCatPurchases: (...args: unknown[]) => mockRestorePurchases(...args),
  showRevenueCatManageSubscriptions: (...args: unknown[]) => mockManageSubscriptions(...args),
  useRevenueCatRuntime: () => ({ message: null, status: 'ready' }),
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
  expect(mockCaptureGameplayEvent).not.toHaveBeenCalledWith(
    'purchase_completed',
    expect.anything(),
  );
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
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_completed', {
    product_kind: 'premium_membership',
    product_key: 'premium_annual',
  });
  expect(allText(renderer!.root)).toContain('Annual Premium is verified and active.');
  expect(allText(renderer!.root)).not.toContain('Purchase Reconciliation Pending');
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
  now.mockRestore();
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
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_completed', {
    product_kind: 'premium_membership',
    product_key: 'premium_monthly',
  });
});

it('explains restore to a Guest Player before the sign-in screen appears', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await renderScreen();

  expect(allText(renderer!.root)).toContain('Sign in to restore purchases');
  expect(allText(renderer!.root)).not.toContain('Restore purchases');

  await act(async () => {
    pressByText(renderer!.root, 'Sign in to restore purchases');
    await flushPromises();
  });

  expect(alert).toHaveBeenCalledTimes(1);
  const [title, message, buttons] = alert.mock.calls[0];
  expect(title).toBe('Sign in to restore purchases');
  expect(message).toContain('Purchases are attached to a Registered Account');
  expect(message).toContain('Signing in with the account that made them recovers');
  expect(mockRouter.push).not.toHaveBeenCalled();
  expect(mockRestorePurchases).not.toHaveBeenCalled();
  expect(mockCreateReconciliation).not.toHaveBeenCalled();

  // A single continue action: the explanation always leads on to sign-in.
  expect(buttons).toHaveLength(1);
  const signIn = (buttons ?? []).find((button) => button.text === 'Sign in');
  await act(async () => {
    signIn?.onPress?.();
    await flushPromises();
  });

  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/(tabs)/(settings)/sign-in',
    params: { returnTo: 'commerce' },
  });
  alert.mockRestore();
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

it('keeps Guest catalog intent through sign-in return without starting a purchase', async () => {
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
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/(tabs)/(settings)/sign-in',
    params: { returnTo: 'commerce' },
  });
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

it('preserves Guest AI Credit Pack selection through sign-in return and confirmation', async () => {
  await renderScreen();
  await openAiCreditPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));

  expect(useCommerceIntentStore.getState().intent).toEqual({
    category: 'ai_credit',
    entrySource: 'profile',
    productKey: 'ai_credit_pack_5',
    productKind: 'ai_credit_pack',
  });
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/(tabs)/(settings)/sign-in',
    params: { returnTo: 'commerce' },
  });
  expect(mockPurchasePackage).not.toHaveBeenCalled();

  mockIdentity = { accountId: 'account_82', isAccount: true };
  mockParams = { source: 'sign_in_return' };
  await act(async () => {
    renderer!.update(<CommerceScreen />);
    await flushPromises();
  });
  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'You’re signed in. 5 AI Credits is still selected. Review it and tap Buy when ready.',
    'Selected before sign-in',
  ]));
  await act(async () => pressByText(renderer!.root, 'Buy'));
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
  expect(mockCaptureGameplayEvent).not.toHaveBeenCalledWith(
    'purchase_completed',
    expect.anything(),
  );

  await openAiCreditPacks();
  expect(pressableByText(renderer!.root, 'Buy').props.disabled).toBe(true);
  expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
});

it('treats AI Credit Pack cancellation as non-error without reconciliation', async () => {
  mockIdentity = { accountId: 'account_82', isAccount: true };
  mockPurchasePackage.mockRejectedValue({ userCancelled: true });
  await renderScreen();
  await confirmSmallAiCreditPackPurchase();

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_cancelled', {
    product_kind: 'ai_credit_pack',
    product_key: 'ai_credit_pack_5',
  });
  expect(mockCreateAiCreditPackReconciliation).not.toHaveBeenCalled();
  expect(allText(renderer!.root)).not.toContain('Purchase Reconciliation Pending');
});

it('reports an AI Credit Pack store failure without starting reconciliation', async () => {
  mockIdentity = { accountId: 'account_82', isAccount: true };
  mockPurchasePackage.mockRejectedValue(new Error('store unavailable'));
  await renderScreen();
  await confirmSmallAiCreditPackPurchase();

  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_failed', {
    product_kind: 'ai_credit_pack',
    product_key: 'ai_credit_pack_5',
    failure_stage: 'store',
  });
  expect(mockCreateAiCreditPackReconciliation).not.toHaveBeenCalled();
  expect(allText(renderer!.root)).toContain('store unavailable');
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
});

it('updates AI Credit balance and completes only after the exact backend grant', async () => {
  mockIdentity = { accountId: 'account_82', isAccount: true };
  mockFetchAiCreditPackReconciliation.mockResolvedValue({ status: 'granted', balance: 9 });
  mockFetchAiCreditBalance.mockResolvedValue(9);
  await renderScreen();
  await confirmSmallAiCreditPackPurchase();

  expect(mockFetchAiCreditBalance).toHaveBeenCalledTimes(1);
  expect(mockSetQueryData).toHaveBeenCalledWith(['economy', 'aiCreditBalance'], 9);
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_completed', {
    product_kind: 'ai_credit_pack',
    product_key: 'ai_credit_pack_5',
  });
  expect(allText(renderer!.root)).toContain(
    '5 AI Credits grant verified. AI Credit balance: 9.',
  );
});

it('offers Retry after a delayed AI Credit grant without another store purchase', async () => {
  const now = jest.spyOn(Date, 'now')
    .mockReturnValueOnce(1_000)
    .mockReturnValueOnce(1_000)
    .mockReturnValue(12_000);
  mockIdentity = { accountId: 'account_82', isAccount: true };
  await renderScreen();
  await confirmSmallAiCreditPackPurchase();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase Reconciliation Pending',
    'Retry reconciliation',
    'Support Reference: SW-AI-CREDIT',
  ]));
  expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
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
  expect(mockCaptureGameplayEvent).not.toHaveBeenCalledWith(
    'purchase_completed',
    expect.anything(),
  );

  await act(async () => pressAncestor(renderer!.root.findByProps({ testID: 'open-stitch-coin-packs' })));
  expect(pressableByText(renderer!.root, 'Buy').props.disabled).toBe(true);
  expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
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
});

it('updates the wallet and emits completion only after the matching backend Coin grant', async () => {
  mockIdentity = { accountId: 'account_81', isAccount: true };
  mockFetchCoinPackReconciliation.mockResolvedValue({ status: 'granted', balance: 420 });
  mockFetchCoinBalance.mockResolvedValue(420);
  await renderScreen();
  await confirmSmallCoinPackPurchase();

  expect(mockFetchCoinBalance).toHaveBeenCalledTimes(1);
  expect(mockSetQueryData).toHaveBeenCalledWith(['economy', 'balance'], 420);
  expect(mockCaptureGameplayEvent).toHaveBeenCalledWith('purchase_completed', {
    product_kind: 'stitch_coin_pack',
    product_key: 'coin_pack_300',
  });
  expect(allText(renderer!.root)).toContain(
    '300 Stitch Coins grant verified. Stitch Coin balance: 420.',
  );
  expect(allText(renderer!.root)).not.toContain('Purchase Reconciliation Pending');
});

it('keeps a delayed Coin grant pending and offers Retry without another store purchase', async () => {
  const now = jest.spyOn(Date, 'now')
    .mockReturnValueOnce(1_000)
    .mockReturnValueOnce(1_000)
    .mockReturnValue(12_000);
  mockIdentity = { accountId: 'account_81', isAccount: true };
  await renderScreen();
  await confirmSmallCoinPackPurchase();

  expect(allText(renderer!.root)).toEqual(expect.arrayContaining([
    'Purchase Reconciliation Pending',
    'Retry reconciliation',
    'Support Reference: SW-COIN-PACK',
  ]));
  expect(mockPurchasePackage).toHaveBeenCalledTimes(1);
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
  });
}

async function openAiCreditPacks(): Promise<void> {
  await act(async () => {
    pressAncestor(renderer!.root.findByProps({ testID: 'open-ai-credit-packs' }));
  });
}

async function confirmSmallCoinPackPurchase(): Promise<void> {
  await openCoinPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  await act(async () => {
    pressByText(renderer!.root, 'Confirm 300 Stitch Coins');
    await flushPromises();
  });
}

async function confirmSmallAiCreditPackPurchase(): Promise<void> {
  await openAiCreditPacks();
  await act(async () => pressByText(renderer!.root, 'Buy'));
  await act(async () => {
    pressByText(renderer!.root, 'Confirm 5 AI Credits');
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
    dailyClaim: { claimed: false, coinsAvailable: 0, resetsAt: '2026-07-30T00:00:00Z' },
  };
}

function activeMembership(plan: 'weekly' | 'monthly' | 'annual') {
  return {
    active: true,
    plan,
    lifecycle: 'active',
    expiresAt: '2026-08-29T00:00:00Z',
    themeAccess: true,
    dailyClaim: { claimed: false, coinsAvailable: 30, resetsAt: '2026-07-30T00:00:00Z' },
  };
}
