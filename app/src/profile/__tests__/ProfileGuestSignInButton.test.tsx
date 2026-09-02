import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ProfileHomeScreen from '../../../app/(tabs)/(profile)/index';
import { listPersonalPatterns } from '@/conversion';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
};

let mockIdentityState = {
  isAccount: false,
  isAuthenticated: true,
  guestId: 'guest-uuid-12345',
  guestCreatedAt: '2026-09-01T12:00:00.000Z',
  accountId: null as string | null,
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
    Screen: ({ children, refreshControl }: { children: React.ReactNode; refreshControl?: React.ReactNode }) =>
      React.createElement(View, null, refreshControl, children),
    Button: ({ title, onPress }: { title: string; onPress?: () => void }) =>
      React.createElement(Text, { onPress }, title),
    Card: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    EmptyState: ({ title, body, actionLabel, onAction }: { title: string; body: string; actionLabel: string; onAction: () => void }) =>
      React.createElement(
        View,
        null,
        React.createElement(Text, null, title),
        React.createElement(Text, null, body),
        React.createElement(Text, { accessibilityLabel: `empty-state:${actionLabel}`, onPress: onAction }, actionLabel),
      ),
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
      isAuthenticated: true,
      guestId: 'guest-uuid-12345',
      guestCreatedAt: '2026-09-01T12:00:00.000Z',
      accountId: null,
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
    mockIdentityState.accountId = 'account-1';

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

  it('waits for account authentication, then loads My Creations', async () => {
    mockIdentityState = {
      ...mockIdentityState,
      accountId: 'account-1',
      isAccount: true,
      isAuthenticated: false,
      isPending: true,
    };
    jest.mocked(listPersonalPatterns).mockResolvedValueOnce([
      {
        id: 'pattern-1',
        title: 'Finished Pattern',
        width: 20,
        height: 20,
        paletteSize: 4,
        previewUrl: 'https://example.com/preview.png',
        thumbnailUrls: null,
        createdAt: '2026-09-02T10:00:00.000Z',
      },
    ]);

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ProfileHomeScreen />);
    });
    expect(listPersonalPatterns).not.toHaveBeenCalled();

    mockIdentityState = {
      ...mockIdentityState,
      isAuthenticated: true,
      isPending: false,
    };
    await act(async () => {
      renderer!.update(<ProfileHomeScreen />);
    });

    expect(listPersonalPatterns).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findAll((node) => node.children.includes('Finished Pattern')).length).toBeGreaterThan(0);
  });

  it('shows Retry instead of the empty state when My Creations fails to load', async () => {
    mockIdentityState = {
      ...mockIdentityState,
      accountId: 'account-1',
      isAccount: true,
      isAuthenticated: true,
    };
    jest.mocked(listPersonalPatterns).mockRejectedValueOnce(new Error('offline'));

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<ProfileHomeScreen />);
    });

    const retryActions = renderer!.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.startsWith('empty-state:'),
    );
    expect(retryActions).toHaveLength(1);
    expect(retryActions[0].props.onPress).toEqual(expect.any(Function));

    jest.mocked(listPersonalPatterns).mockResolvedValueOnce([]);
    await act(async () => {
      retryActions[0].props.onPress();
    });
    expect(listPersonalPatterns).toHaveBeenCalledTimes(2);
  });
});
