import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useRewardedAdFlow } from '../useRewardedAdFlow';
import { __resetAdMobGlobals } from '../../ads';

jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  getRewardedAdUnitId: (platform: 'android' | 'ios') =>
    platform === 'ios' ? 'ios-rewarded-unit' : 'android-rewarded-unit',
}));

jest.mock('react-native-google-mobile-ads', () => {
  const RewardedAdEventType = { LOADED: 'rewarded_loaded', EARNED_REWARD: 'rewarded_earned_reward' };
  const AdEventType = { ERROR: 'error', CLOSED: 'closed', OPENED: 'opened', CLICKED: 'clicked' };
  const ads: Array<{
    options: { serverSideVerificationOptions?: { customData?: string } };
    listeners: Record<string, Array<(payload?: unknown) => void>>;
    loaded: boolean;
    show: jest.Mock;
  }> = [];
  const createForAdRequest = jest.fn(
    (_unit: string, options: { serverSideVerificationOptions?: { customData?: string } }) => {
      const entry = {
        options,
        listeners: {} as Record<string, Array<(payload?: unknown) => void>>,
        loaded: false,
        show: jest.fn(() => Promise.resolve()),
      };
      ads.push(entry);
      return {
        get loaded() {
          return entry.loaded;
        },
        addAdEventListener: (type: string, cb: (payload?: unknown) => void) => {
          (entry.listeners[type] = entry.listeners[type] ?? []).push(cb);
          return () => {
            entry.listeners[type] = (entry.listeners[type] ?? []).filter((f) => f !== cb);
          };
        },
        load: jest.fn(),
        show: entry.show,
      };
    },
  );
  return {
    __esModule: true,
    default: () => ({ initialize: () => Promise.resolve([]) }),
    RewardedAd: { createForAdRequest },
    RewardedAdEventType,
    AdEventType,
    AdsConsent: {
      gatherConsent: jest.fn(() => Promise.resolve({ canRequestAds: true })),
      reset: jest.fn(),
    },
    __mock: {
      ads,
      loadLatest: () => {
        const latest = ads[ads.length - 1];
        latest.loaded = true;
        (latest.listeners[RewardedAdEventType.LOADED] ?? []).forEach((cb) => cb());
      },
      fireLatest: (type: string, payload?: unknown) => {
        const latest = ads[ads.length - 1];
        (latest.listeners[type] ?? []).forEach((cb) => cb(payload));
      },
      reset: () => {
        ads.length = 0;
        createForAdRequest.mockClear();
      },
    },
  };
});

let mockResolveAttempt: ((value: unknown) => void) | null = null;
const mockOpenAttempt = jest.fn(
  () =>
    new Promise((resolve) => {
      mockResolveAttempt = resolve;
    }),
);

jest.mock('../../api/economy', () => ({
  coinBalanceQueryKey: ['balance'],
  rewardDayQueryKey: ['reward-day'],
  useOpenAdAttempt: () => ({ mutateAsync: mockOpenAttempt }),
  useClaimAdReward: () => ({ mutateAsync: jest.fn(() => Promise.resolve()) }),
}));
jest.mock('../../api/membership', () => ({ membershipQueryKey: ['membership'] }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(() => Promise.resolve()) }),
}));
jest.mock('../useRewardedAdSsvPolling', () => ({
  useRewardedAdSsvPolling: () => ({
    isVerifying: false,
    startPolling: jest.fn(),
    stopPolling: jest.fn(),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mobileAds = require('react-native-google-mobile-ads') as {
  __mock: {
    ads: Array<{ options: { serverSideVerificationOptions?: { customData?: string } }; show: jest.Mock }>;
    loadLatest: () => void;
    fireLatest: (type: string, payload?: unknown) => void;
    reset: () => void;
  };
};

type Flow = ReturnType<typeof useRewardedAdFlow>;

function Harness({ onRender }: { onRender: (flow: Flow) => void }) {
  onRender(
    useRewardedAdFlow({
      localizeAttemptError: () => 'attempt',
      localizeClaimError: () => 'claim',
      localizeLoadError: () => 'load',
      localizeVerificationExpired: () => 'expired',
    }),
  );
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useRewardedAdFlow', () => {
  beforeEach(() => {
    mobileAds.__mock.reset();
    __resetAdMobGlobals();
    mockOpenAttempt.mockClear();
    mockResolveAttempt = null;
  });

  it('only shows an ad whose SSV request carries the attempt nonce', async () => {
    let flow: Flow | null = null;
    await act(async () => {
      TestRenderer.create(<Harness onRender={(f) => (flow = f)} />);
    });
    await flush();
    // A preloaded ad (no attempt yet) is ready before the player taps.
    act(() => mobileAds.__mock.loadLatest());

    await act(async () => {
      void flow!.watch();
    });
    await flush();
    await act(async () => {
      mockResolveAttempt!({ nonce: 'nonce-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), ssvActive: true });
    });
    await flush();
    act(() => mobileAds.__mock.loadLatest());
    await flush();

    const shown = mobileAds.__mock.ads.filter((ad) => ad.show.mock.calls.length > 0);
    expect(shown.length).toBeGreaterThan(0);
    for (const ad of shown) {
      expect(ad.options.serverSideVerificationOptions?.customData).toBe('nonce-1');
    }
  });

  it.each([
    ['SSV verification', true],
    ['client claim', false],
  ])('does not auto-show the reloaded ad after an earned reward (%s)', async (_label, ssvActive) => {
    let flow: Flow | null = null;
    await act(async () => {
      TestRenderer.create(<Harness onRender={(f) => (flow = f)} />);
    });
    await flush();

    await act(async () => {
      void flow!.watch();
    });
    await act(async () => {
      mockResolveAttempt!({ nonce: 'nonce-1', expiresAt: new Date(Date.now() + 60_000).toISOString(), ssvActive });
    });
    await flush();
    act(() => mobileAds.__mock.loadLatest());
    await flush();

    const attemptAd = mobileAds.__mock.ads[mobileAds.__mock.ads.length - 1];
    expect(attemptAd.show).toHaveBeenCalledTimes(1);

    await act(async () => {
      mobileAds.__mock.fireLatest('rewarded_earned_reward', { type: 'coins', amount: 10 });
    });
    await act(async () => {
      mobileAds.__mock.fireLatest('closed');
    });
    await flush();
    // The single-use ad reloads after dismissal; that reload must not start another ad.
    act(() => mobileAds.__mock.loadLatest());
    await flush();

    const shownCount = mobileAds.__mock.ads.reduce((sum, ad) => sum + ad.show.mock.calls.length, 0);
    expect(shownCount).toBe(1);
  });
});
