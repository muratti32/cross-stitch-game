import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import CommerceScreen from '../../../app/(tabs)/(profile)/commerce';
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
  missingCanonicalRevenueCatProducts: () => [],
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

function offering() {
  return {
    current: {
      availablePackages: productRows.map(([key, priceString]) => ({
        identifier: `$rc_${key}`,
        product: {
          identifier: `com.avk.stitchwish.${key}`,
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
    'Eligible for a 3-day free trial',
  ]));
  expect(renderer!.root.findByProps({ testID: 'premium-premium_annual' }).props.style)
    .toBeDefined();
  expect(mockTrialEligible).toHaveBeenCalledWith('com.avk.stitchwish.premium_monthly');
});

it('shows the normal Monthly paid offer when eligibility is unknown or ineligible', async () => {
  mockTrialEligible.mockResolvedValue(false);
  await renderScreen();

  expect(allText(renderer!.root)).not.toContain('Eligible for a 3-day free trial');
  expect(allText(renderer!.root)).toContain('$7.99');
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
