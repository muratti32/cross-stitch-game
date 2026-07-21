import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useRewardedAd as useRewardedAdImpl } from '../useRewardedAd';

// Provide the ad unit IDs without depending on env-load timing. Both src/ads and
// the hook read getRewardedAdUnitId from this module.
jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  getRewardedAdUnitId: (platform: 'android' | 'ios') =>
    platform === 'ios' ? 'ios-rewarded-unit' : 'android-rewarded-unit',
}));

// The AdMob native module is native-only and throws when imported under jest, so
// we replace it with a controllable fake. Everything lives inside the factory
// (jest hoists jest.mock above module-level declarations) and is exposed via
// `__mock` for the test to drive the ad lifecycle.
jest.mock('react-native-google-mobile-ads', () => {
  const RewardedAdEventType = {
    LOADED: 'rewarded_loaded',
    EARNED_REWARD: 'rewarded_earned_reward',
  };
  const AdEventType = {
    ERROR: 'error',
    CLOSED: 'closed',
    OPENED: 'opened',
    CLICKED: 'clicked',
  };
  const listeners: Record<string, Array<(payload?: unknown) => void>> = {};
  const state = { loaded: false };
  const load = jest.fn();
  const show = jest.fn(() => Promise.resolve());
  const ad = {
    get loaded() {
      return state.loaded;
    },
    addAdEventListener: (type: string, cb: (payload?: unknown) => void) => {
      (listeners[type] = listeners[type] ?? []).push(cb);
      return () => {
        listeners[type] = (listeners[type] ?? []).filter((f) => f !== cb);
      };
    },
    load,
    show,
  };
  const createForAdRequest = jest.fn(() => ad);
  return {
    __esModule: true,
    default: () => ({ initialize: () => Promise.resolve([]) }),
    RewardedAd: { createForAdRequest },
    RewardedAdEventType,
    AdEventType,
    __mock: {
      load,
      show,
      createForAdRequest,
      setLoaded: (value: boolean) => {
        state.loaded = value;
      },
      fire: (type: string, payload?: unknown) => {
        (listeners[type] ?? []).forEach((cb) => cb(payload));
      },
      reset: () => {
        Object.keys(listeners).forEach((k) => delete listeners[k]);
        state.loaded = false;
        load.mockClear();
        show.mockClear();
        createForAdRequest.mockClear();
      },
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const admobMock = require('react-native-google-mobile-ads').__mock as {
  load: jest.Mock;
  show: jest.Mock;
  createForAdRequest: jest.Mock;
  setLoaded: (value: boolean) => void;
  fire: (type: string, payload?: unknown) => void;
  reset: () => void;
};

type UseRewardedAd = typeof useRewardedAdImpl;
const useRewardedAd: UseRewardedAd = useRewardedAdImpl;

beforeEach(() => {
  admobMock.reset();
});

type HookValue = ReturnType<UseRewardedAd>;

async function mountHook(options?: Parameters<UseRewardedAd>[0]): Promise<{
  current: () => HookValue;
}> {
  const ref: { current: HookValue | null } = { current: null };
  function Harness(props: NonNullable<Parameters<UseRewardedAd>[0]>): null {
    ref.current = useRewardedAd(props);
    return null;
  }
  await act(async () => {
    TestRenderer.create(<Harness {...(options ?? {})} />);
    // Flush the initializeAdMob() promise so the ad's load() is invoked.
    await Promise.resolve();
  });
  return {
    current: () => {
      if (ref.current === null) {
        throw new Error('hook not mounted');
      }
      return ref.current;
    },
  };
}

describe('useRewardedAd', () => {
  it('requests a non-personalized ad with the SSV options and starts loading', async () => {
    const { current } = await mountHook({
      serverSideVerification: { customData: 'player-123' },
    });

    expect(admobMock.createForAdRequest).toHaveBeenCalledWith('ios-rewarded-unit', {
      requestNonPersonalizedAdsOnly: true,
      serverSideVerificationOptions: { customData: 'player-123' },
    });
    expect(admobMock.load).toHaveBeenCalledTimes(1);
    expect(current().status).toBe('loading');
    expect(current().isLoaded).toBe(false);
  });

  it('becomes loaded when the ad reports LOADED', async () => {
    const { current } = await mountHook();

    await act(async () => {
      admobMock.fire('rewarded_loaded');
    });

    expect(current().status).toBe('loaded');
    expect(current().isLoaded).toBe(true);
    expect(current().error).toBeNull();
  });

  it('shows the ad and forwards the earned reward, then reloads after CLOSED', async () => {
    const onEarnedReward = jest.fn();
    const { current } = await mountHook({ onEarnedReward });

    await act(async () => {
      admobMock.fire('rewarded_loaded');
    });
    admobMock.setLoaded(true);

    act(() => {
      current().show();
    });
    expect(admobMock.show).toHaveBeenCalledTimes(1);
    expect(current().status).toBe('showing');

    await act(async () => {
      admobMock.fire('rewarded_earned_reward', { type: 'coins', amount: 10 });
    });
    expect(onEarnedReward).toHaveBeenCalledWith({ type: 'coins', amount: 10 });

    admobMock.load.mockClear();
    await act(async () => {
      admobMock.fire('closed');
    });
    // A rewarded ad is single-use: after dismissal it reloads for the next show.
    expect(current().status).toBe('loading');
    expect(admobMock.load).toHaveBeenCalledTimes(1);
  });

  it('does not show when no ad is loaded', async () => {
    const { current } = await mountHook();
    admobMock.setLoaded(false);

    act(() => {
      current().show();
    });

    expect(admobMock.show).not.toHaveBeenCalled();
    expect(current().status).toBe('loading');
  });

  it('surfaces a load error', async () => {
    const { current } = await mountHook();

    await act(async () => {
      admobMock.fire('error', new Error('no-fill'));
    });

    expect(current().status).toBe('error');
    expect(current().error).toEqual(new Error('no-fill'));
  });
});
