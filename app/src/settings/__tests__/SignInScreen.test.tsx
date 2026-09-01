import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import SignInScreen from '../../../app/(tabs)/(settings)/sign-in';

let mockIsAccount = false;
let mockParams: { returnTo?: string } = {};
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
  useIdentityStore: (selector: (state: { isAccount: boolean }) => unknown) =>
    selector({ isAccount: mockIsAccount }),
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
    mockParams = {};
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
