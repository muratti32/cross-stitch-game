import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ProfileHomeScreen from '../../../app/(tabs)/(profile)/index';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
};

let mockIdentityState = {
  isAccount: false,
  guestId: 'guest-uuid-12345',
  guestCreatedAt: '2026-09-01T12:00:00.000Z',
  isPending: false,
  isOfflinePending: false,
  bootstrap: jest.fn(),
};

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (callback: () => void) => {
      React.useEffect(() => {
        callback();
      }, [callback]);
    },
  };
});

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
    refetchQueries: jest.fn().mockResolvedValue(undefined),
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
  const { Text, View } = require('react-native');
  return {
    Screen: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    Button: ({ title, onPress }: { title: string; onPress?: () => void }) =>
      React.createElement(Text, { onPress }, title),
    Card: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    EmptyState: () => React.createElement(View, null),
    PatternImage: () => React.createElement(View, null),
  };
});

jest.mock('@/identity/guestIdentity', () => ({
  useIdentityStore: (selector?: (state: typeof mockIdentityState) => unknown) =>
    selector ? selector(mockIdentityState) : mockIdentityState,
}));

jest.mock('@/api/creatorProfile', () => ({
  useCreatorProfile: () => ({
    data: null,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock('@/api/commerce', () => ({
  useAiCreditBalance: () => ({ data: 0 }),
}));

jest.mock('@/api/economy', () => ({
  useCoinBalance: () => ({ data: 0 }),
  useRewardDay: () => ({ data: null }),
  useOpenAdAttempt: () => ({ mutate: jest.fn() }),
  useClaimAdReward: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/api/membership', () => ({
  useMembership: () => ({ data: null }),
  usePremiumDailyClaim: () => ({ mutate: jest.fn() }),
}));

jest.mock('@/api/dailyTasks', () => ({
  DAILY_TASK_COIN: 10,
  useDailyTaskBoard: () => ({ data: { tasks: [] }, isLoading: false }),
}));

jest.mock('@/api/social', () => ({
  useLikedPatterns: () => ({ data: { pages: [] }, isLoading: false }),
}));

jest.mock('@/conversion', () => ({
  listPersonalPatterns: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/local-db', () => ({
  getPendingPersonalPatterns: jest.fn().mockReturnValue([]),
}));

jest.mock('@/session-preparation', () => ({
  preparePersonalSession: jest.fn(),
  preparePendingPersonalSession: jest.fn(),
  waitUntilSessionReady: jest.fn(),
}));

jest.mock('@/hooks/useRewardedAd', () => ({
  useRewardedAd: () => ({ isLoaded: false, show: jest.fn() }),
}));

describe('ProfileHomeScreen - Guest Sign In CTA', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIdentityState = {
      isAccount: false,
      guestId: 'guest-uuid-12345',
      guestCreatedAt: '2026-09-01T12:00:00.000Z',
      isPending: false,
      isOfflinePending: false,
      bootstrap: jest.fn(),
    };
  });

  it('renders guest sign in button and navigates to sign-in with returnTo: profile', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ProfileHomeScreen />);
    });

    const root = renderer!.root;
    const signInButtons = root.findAll(
      (node) =>
        node.props.accessibilityRole === 'button' &&
        node.props.onPress &&
        node.props.accessibilityLabel !== undefined,
    );

    const guestSignInBtn = signInButtons.find((btn) => {
      const label = btn.props.accessibilityLabel;
      return typeof label === 'string' && (label.includes('Giriş') || label.includes('Sign In'));
    });

    expect(guestSignInBtn).toBeDefined();

    act(() => {
      guestSignInBtn!.props.onPress();
    });

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/(tabs)/(settings)/sign-in',
      params: { returnTo: '/(tabs)/(profile)' },
    });
  });

  it('does not render guest sign in button when authenticated as account', async () => {
    mockIdentityState.isAccount = true;

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ProfileHomeScreen />);
    });

    const root = renderer!.root;
    const guestSignInBtn = root.findAll(
      (node) =>
        node.props.accessibilityRole === 'button' &&
        node.props.onPress &&
        typeof node.props.accessibilityLabel === 'string' &&
        (node.props.accessibilityLabel.includes('Giriş Yap / Kayıt Ol') ||
          node.props.accessibilityLabel.includes('Sign In / Sign Up')),
    );

    expect(guestSignInBtn.length).toBe(0);
  });
});
