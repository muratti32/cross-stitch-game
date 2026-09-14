import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RewardedAdCard } from '../RewardedAdCard';
import * as useRewardedAdHook from '../../hooks/useRewardedAd';

const mockOpenAdAttempt = jest.fn();
const mockClaimAdReward = jest.fn();
const mockRefetch = jest.fn();

jest.mock('../../api/economy', () => {
  const actual = jest.requireActual('../../api/economy');
  return {
    ...actual,
    useRewardDay: jest.fn(() => ({
      data: {
        adsCompleted: 0,
        adsRemaining: 3,
        coinsConsumed: 0,
        coinsRemaining: 30,
        balance: 50,
        resetsAt: '2026-09-15T00:00:00Z',
        premiumClaimed: false,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
    })),
    useOpenAdAttempt: jest.fn(() => ({
      mutateAsync: mockOpenAdAttempt,
    })),
    useClaimAdReward: jest.fn(() => ({
      mutateAsync: mockClaimAdReward,
    })),
  };
});

jest.mock('react-native-google-mobile-ads', () => ({
  RewardedAd: { createForAdRequest: jest.fn() },
  RewardedAdEventType: { LOADED: 'rewarded_loaded', EARNED_REWARD: 'rewarded_earned_reward' },
  AdEventType: { ERROR: 'error', CLOSED: 'closed', OPENED: 'opened', CLICKED: 'clicked' },
  AdsConsent: { gatherConsent: jest.fn(() => Promise.resolve({ canRequestAds: true })), reset: jest.fn() },
  default: () => ({ initialize: () => Promise.resolve([]) }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => {
    const React = require('react');
    const { Text } = require('react-native');
    return React.createElement(Text, null, name);
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'home.dailyPool.adRewardEarned') return 'Ad reward earned! Verifying with backend…';
      if (key === 'rewardedAdCard.watchForCoins') return `Watch for ${params?.count ?? 10} Coins`;
      return key;
    },
  }),
}));

describe('RewardedAdCard', () => {
  let queryClient: QueryClient;
  let adHookCallbacks: { onEarnedReward?: () => Promise<void> };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    adHookCallbacks = {};
    jest.spyOn(useRewardedAdHook, 'useRewardedAd').mockImplementation((options: any) => {
      adHookCallbacks.onEarnedReward = options?.onEarnedReward;
      return {
        status: 'loaded',
        isLoaded: true,
        error: null,
        show: jest.fn(),
        reload: jest.fn(),
      };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does NOT call claimAdReward when ssvActive is true', async () => {
    mockOpenAdAttempt.mockResolvedValue({
      nonce: 'nonce-ssv-123',
      expiresAt: '2026-09-14T12:00:00Z',
      ssvActive: true,
    });

    let renderer: TestRenderer.ReactTestRenderer = undefined as any;
    await act(async () => {
      renderer = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <RewardedAdCard enabled={true} />
        </QueryClientProvider>,
      );
    });

    const buttons = renderer.root.findAll((node) => node.props.onPress && node.props.title?.includes('Watch'));
    expect(buttons.length).toBeGreaterThan(0);

    await act(async () => {
      buttons[0].props.onPress();
    });

    expect(mockOpenAdAttempt).toHaveBeenCalled();

    // Trigger ad reward earned
    await act(async () => {
      await adHookCallbacks.onEarnedReward?.();
    });

    // claimAdReward should NOT have been called because ssvActive is true (Issue #247 / ADR-0033)
    expect(mockClaimAdReward).not.toHaveBeenCalled();
  });

  test('calls claimAdReward when ssvActive is false (dev/local fallback)', async () => {
    mockOpenAdAttempt.mockResolvedValue({
      nonce: 'nonce-non-ssv-456',
      expiresAt: '2026-09-14T12:00:00Z',
      ssvActive: false,
    });

    let renderer: TestRenderer.ReactTestRenderer = undefined as any;
    await act(async () => {
      renderer = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <RewardedAdCard enabled={true} />
        </QueryClientProvider>,
      );
    });

    const buttons = renderer.root.findAll((node) => node.props.onPress && node.props.title?.includes('Watch'));
    expect(buttons.length).toBeGreaterThan(0);

    await act(async () => {
      buttons[0].props.onPress();
    });

    expect(mockOpenAdAttempt).toHaveBeenCalled();

    // Trigger ad reward earned
    await act(async () => {
      await adHookCallbacks.onEarnedReward?.();
    });

    // In non-SSV mode, claimAdReward MUST be called
    expect(mockClaimAdReward).toHaveBeenCalledWith('nonce-non-ssv-456');
  });
});
