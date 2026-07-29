import React from 'react';
import { ActivityIndicator, Text } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

import { PremiumDailyCoinClaimCard } from '@/components/PremiumDailyCoinClaimCard';
import { ThemeCollectionCard } from '@/components/ThemeCollectionCard';

const mockRouter = { push: jest.fn() };
const mockRefetchMembership = jest.fn().mockResolvedValue(undefined);
const mockClaim = jest.fn();
const mockResetClaim = jest.fn();
const mockSelectTheme = jest.fn().mockResolvedValue(undefined);
let mockIsAccount = true;
let mockMembershipQuery: Record<string, unknown>;
let mockClaimMutation: Record<string, unknown>;
let mockThemeState: Record<string, unknown>;

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const MockReact = require('react');
    const { Text: MockText } = require('react-native');
    return MockReact.createElement(MockText, null, name);
  },
}));

jest.mock('@/api/membership', () => ({
  useMembership: () => mockMembershipQuery,
  usePremiumDailyClaim: () => mockClaimMutation,
}));

jest.mock('@/identity/guestIdentity', () => ({
  useIdentityStore: (selector: (state: { isAccount: boolean }) => unknown) =>
    selector({ isAccount: mockIsAccount }),
}));

jest.mock('@/membership/themes', () => ({
  MEMBERSHIP_THEMES: [
    {
      id: 'default', name: 'Classic Linen', premium: false, gridBackground: '#fff',
      celebrationAccent: '#111',
    },
    {
      id: 'rose-garden', name: 'Rose Garden', premium: true, gridBackground: '#fee',
      celebrationAccent: '#c36',
    },
    {
      id: 'moonlit-aida', name: 'Moonlit Aida', premium: true, gridBackground: '#123',
      celebrationAccent: '#6cd',
    },
  ],
  useActiveMembershipTheme: () => mockThemeState,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockIsAccount = true;
  mockMembershipQuery = membershipQuery({
    active: true,
    dailyClaim: { claimed: false, coinsAvailable: 20, resetsAt: '2026-07-30T00:00:00Z' },
  });
  mockClaimMutation = {
    data: undefined,
    error: null,
    isPending: false,
    mutate: mockClaim,
    reset: mockResetClaim,
  };
  mockThemeState = {
    selectTheme: mockSelectTheme,
    theme: { id: 'default' },
    themeAccess: true,
  };
});

it('shows availability, loading, and the successful backend claim result', () => {
  const renderer = render(<PremiumDailyCoinClaimCard enabled isAccount />);
  expect(allText(renderer.root)).toContain('20 Stitch Coins available now');

  act(() => pressByText(renderer.root, 'Claim 20 Coins'));
  expect(mockClaim).toHaveBeenCalledTimes(1);

  mockClaimMutation = { ...mockClaimMutation, isPending: true };
  act(() => renderer.update(<PremiumDailyCoinClaimCard enabled isAccount />));
  expect(renderer.root.findAllByType(ActivityIndicator)).not.toHaveLength(0);

  mockClaimMutation = {
    ...mockClaimMutation,
    data: { amount: 20, balance: 140, claimed: true, coinsConsumed: 30, replayed: false },
    isPending: false,
  };
  act(() => renderer.update(<PremiumDailyCoinClaimCard enabled isAccount />));
  expect(allText(renderer.root)).toContain(
    '20 Stitch Coins added by the Game Backend. Balance: 140.',
  );
  act(() => renderer.unmount());
});

it('distinguishes claimed and exhausted shared-pool states', () => {
  mockMembershipQuery = membershipQuery({
    active: true,
    dailyClaim: { claimed: true, coinsAvailable: 0, resetsAt: '2026-07-30T00:00:00Z' },
  });
  const renderer = render(<PremiumDailyCoinClaimCard enabled isAccount />);
  expect(allText(renderer.root)).toContain('Already claimed for this Reward Day.');

  mockMembershipQuery = membershipQuery({
    active: true,
    dailyClaim: { claimed: false, coinsAvailable: 0, resetsAt: '2026-07-30T00:00:00Z' },
  });
  act(() => renderer.update(<PremiumDailyCoinClaimCard enabled isAccount />));
  expect(allText(renderer.root)).toContain(
    "Today's shared reward pool is exhausted. It resets at the next Reward Day.",
  );
  act(() => renderer.unmount());
});

it('shows actionable availability and claim errors', () => {
  mockMembershipQuery = {
    data: undefined,
    error: new Error('Membership temporarily unavailable.'),
    isError: true,
    isLoading: false,
    refetch: mockRefetchMembership,
  };
  const renderer = render(<PremiumDailyCoinClaimCard enabled isAccount />);
  expect(allText(renderer.root)).toEqual(expect.arrayContaining([
    'Membership temporarily unavailable.',
    'Try again',
  ]));
  act(() => pressByText(renderer.root, 'Try again'));
  expect(mockRefetchMembership).toHaveBeenCalledTimes(1);

  mockMembershipQuery = membershipQuery({
    active: true,
    dailyClaim: { claimed: false, coinsAvailable: 30, resetsAt: '2026-07-30T00:00:00Z' },
  });
  mockClaimMutation = {
    ...mockClaimMutation,
    error: new Error('Could not reach the Game Backend.'),
  };
  act(() => renderer.update(<PremiumDailyCoinClaimCard enabled isAccount />));
  expect(allText(renderer.root)).toEqual(expect.arrayContaining([
    'Could not reach the Game Backend.',
    'Try claim again',
  ]));
  act(() => renderer.unmount());
});

it('gates the claim and opens Premium with the premium_benefit source', () => {
  mockMembershipQuery = membershipQuery({
    active: false,
    dailyClaim: { claimed: false, coinsAvailable: 0, resetsAt: '2026-07-30T00:00:00Z' },
  });
  const renderer = render(<PremiumDailyCoinClaimCard enabled isAccount />);
  expect(renderer.root.findByProps({ testID: 'premium-daily-claim-locked' })).toBeDefined();
  act(() => pressByText(renderer.root, 'View Premium plans'));
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/(tabs)/(profile)/commerce',
    params: { category: 'premium', source: 'premium_benefit' },
  });
  act(() => renderer.unmount());
});

it('allows active and trial theme access to select and persist through the existing selector', () => {
  mockThemeState = {
    selectTheme: mockSelectTheme,
    theme: { id: 'rose-garden' },
    themeAccess: true,
  };
  const renderer = render(<ThemeCollectionCard />);
  expect(allText(renderer.root)).toContain(
    'Premium theme access is active, including during an eligible Monthly Trial.',
  );
  act(() => renderer.root.findByProps({ testID: 'appearance-theme-moonlit-aida' }).props.onPress());
  expect(mockSelectTheme).toHaveBeenCalledWith('moonlit-aida');
  act(() => renderer.unmount());
});

it('keeps Premium themes inspectable while locked and routes to Premium context', () => {
  mockThemeState = {
    selectTheme: mockSelectTheme,
    theme: { id: 'default' },
    themeAccess: false,
  };
  const renderer = render(<ThemeCollectionCard />);
  expect(allText(renderer.root)).toEqual(expect.arrayContaining([
    'Rose Garden',
    'Moonlit Aida',
    'Preview the collection here. Premium Membership or an eligible Monthly Trial unlocks selection.',
  ]));
  act(() => renderer.root.findByProps({ testID: 'appearance-theme-rose-garden' }).props.onPress());
  expect(mockSelectTheme).not.toHaveBeenCalled();
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/(tabs)/(profile)/commerce',
    params: { category: 'premium', source: 'premium_benefit' },
  });
  act(() => renderer.unmount());
});

function membershipQuery(data: Record<string, unknown>) {
  return {
    data,
    error: null,
    isError: false,
    isLoading: false,
    refetch: mockRefetchMembership,
  };
}

function render(node: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer: TestRenderer.ReactTestRenderer | null = null;
  act(() => {
    renderer = TestRenderer.create(node);
  });
  return renderer!;
}

function allText(root: ReactTestInstance): string[] {
  return root.findAllByType(Text).map((node) => textValue(node.props.children));
}

function pressByText(root: ReactTestInstance, text: string): void {
  const label = root.findAllByType(Text).find((node) => textValue(node.props.children) === text);
  if (!label) throw new Error(`Missing text: ${text}`);
  let current: ReactTestInstance | null = label;
  while (current !== null && typeof current.props.onPress !== 'function') current = current.parent;
  if (current === null) throw new Error(`Missing Pressable for: ${text}`);
  current.props.onPress();
}

function textValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(textValue).join('');
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
