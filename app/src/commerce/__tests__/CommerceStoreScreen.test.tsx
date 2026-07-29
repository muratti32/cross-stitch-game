import React from 'react';
import { Pressable, Text, View } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import CommerceScreen from '../../../app/(tabs)/(profile)/commerce';
import { useCommerceIntentStore } from '../commerceIntent';

let mockParams: { source?: string } = { source: 'profile' };
let mockIdentity = { accountId: null as string | null, isAccount: false };

const mockRouter = {
  back: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};
const mockCaptureGameplayEvent = jest.fn().mockResolvedValue(undefined);
const mockGetOfferings = jest.fn();
const mockPurchasePackage = jest.fn();
const mockRestorePurchases = jest.fn();
const mockRefetchQueries = jest.fn().mockResolvedValue(undefined);
let renderer: TestRenderer.ReactTestRenderer | null = null;

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => mockRouter,
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ refetchQueries: mockRefetchQueries }),
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
  useCoinBalance: () => ({ data: 120 }),
}));

jest.mock('@/api/commerce', () => ({
  useAiCreditBalance: () => ({ data: 4 }),
}));

jest.mock('@/api/membership', () => ({
  useMembership: () => ({ data: undefined }),
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
  missingCanonicalRevenueCatProducts: () => [],
  purchaseRevenueCatPackage: (...args: unknown[]) => mockPurchasePackage(...args),
  restoreRevenueCatPurchases: (...args: unknown[]) => mockRestorePurchases(...args),
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
        },
      })),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { source: 'profile' };
  mockIdentity = { accountId: null, isAccount: false };
  mockGetOfferings.mockResolvedValue(offering());
  useCommerceIntentStore.getState().clearIntent();
});

afterEach(() => {
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
