import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import SignInScreen from '../../../app/(tabs)/(settings)/sign-in';

let mockIsAccount = false;
let mockRequiresSignIn = false;
let mockParams: { returnTo?: string } = {};
const mockContinueAsGuest = jest.fn().mockResolvedValue(undefined);
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(false),
};

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouter.push(...args),
    replace: (...args: unknown[]) => mockRouter.replace(...args),
    back: (...args: unknown[]) => mockRouter.back(...args),
    canGoBack: (...args: unknown[]) => mockRouter.canGoBack(...args),
  },
  useLocalSearchParams: () => mockParams,
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
  };
});

jest.mock('@/identity/guestIdentity', () => ({
  useIdentityStore: (
    selector: (state: { isAccount: boolean; requiresSignIn: boolean }) => unknown,
  ) => selector({ isAccount: mockIsAccount, requiresSignIn: mockRequiresSignIn }),
  continueAsGuest: (...args: unknown[]) => mockContinueAsGuest(...args),
}));

jest.mock('@/identity/emailAuth', () => ({
  requestEmailOtp: jest.fn().mockResolvedValue(undefined),
  verifyEmailOtp: jest.fn().mockResolvedValue({ kind: 'verified' }),
}));

jest.mock('@/identity/firebaseSso', () => ({
  canUseAppleSso: jest.fn().mockResolvedValue(false),
  canUseGoogleSso: jest.fn().mockReturnValue(false),
  signInWithAppleSso: jest.fn(),
  signInWithGoogleSso: jest.fn(),
}));

jest.mock('@/config', () => ({
  isFirebaseSsoConfigured: jest.fn().mockReturnValue(false),
}));

jest.mock('@/navigation/foregroundEntryNavigation', () => ({
  withProtectedRoundTrip: jest.fn((fn) => fn()),
}));

describe('SignInScreen navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAccount = false;
    mockRequiresSignIn = false;
    mockParams = {};
    mockContinueAsGuest.mockResolvedValue(undefined);
  });

  it('redirects to profile tab when returnTo is /(tabs)/(profile) and sign-in completes', () => {
    mockParams = { returnTo: '/(tabs)/(profile)' };
    mockIsAccount = true;

    act(() => {
      TestRenderer.create(<SignInScreen />);
    });

    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/(profile)');
  });

  it('redirects to settings by default when returnTo is not provided', () => {
    mockParams = {};
    mockIsAccount = true;

    act(() => {
      TestRenderer.create(<SignInScreen />);
    });

    expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/(settings)');
  });

  it('redirects to onboarding welcome when returnTo is /onboarding/welcome', () => {
    mockParams = { returnTo: '/onboarding/welcome' };
    mockIsAccount = true;

    act(() => {
      TestRenderer.create(<SignInScreen />);
    });

    expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding/welcome');
  });

  it('redirects to commerce when returnTo is a commerce target', () => {
    mockParams = { returnTo: 'commerce' };
    mockIsAccount = true;

    act(() => {
      TestRenderer.create(<SignInScreen />);
    });

    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/(tabs)/(profile)/commerce',
      params: { source: 'sign_in_return' },
    });
  });
});

/**
 * Regression (#222): the Sign in required gate replaced every route, and its
 * only exit was authenticating - so a player who could not sign in had no way
 * back into the game.
 */
describe('SignInScreen sign-in gate exit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAccount = false;
    mockRequiresSignIn = false;
    mockParams = {};
    mockContinueAsGuest.mockResolvedValue(undefined);
  });

  function findByLabel(tree: TestRenderer.ReactTestRenderer, label: string) {
    return tree.root.findAll(
      (node) => typeof node.type !== 'string' && node.props.children === label,
    );
  }

  it('offers Cancel rather than a guest exit outside the gate', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<SignInScreen />);
    });

    expect(findByLabel(tree, 'Cancel')).toHaveLength(1);
    expect(findByLabel(tree, 'Continue as guest')).toHaveLength(0);
  });

  it('leaves the gate as a Guest Player and returns to the root route', async () => {
    mockRequiresSignIn = true;
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<SignInScreen />);
    });

    expect(findByLabel(tree, 'Cancel')).toHaveLength(0);
    const [guestExit] = findByLabel(tree, 'Continue as guest');
    await act(async () => {
      guestExit.props.onPress();
    });

    expect(mockContinueAsGuest).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  it('keeps the player on the gate and reports a failed guest exit', async () => {
    mockRequiresSignIn = true;
    mockContinueAsGuest.mockRejectedValue(new Error('storage unavailable'));
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<SignInScreen />);
    });

    const [guestExit] = findByLabel(tree, 'Continue as guest');
    await act(async () => {
      guestExit.props.onPress();
    });

    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(
      tree.root.findAll(
        (node) =>
          typeof node.type !== 'string' &&
          node.props.children === "Couldn't continue as guest. Please try again.",
      ),
    ).not.toHaveLength(0);
  });
});
