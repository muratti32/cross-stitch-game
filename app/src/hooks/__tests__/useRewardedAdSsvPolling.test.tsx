import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useRewardedAdSsvPolling,
  UseRewardedAdSsvPollingOptions,
} from '../useRewardedAdSsvPolling';
import { fetchRewardDay, RewardDayView } from '../../api/economy';

jest.mock('../../api/economy', () => ({
  fetchRewardDay: jest.fn(),
}));

const mockFetchRewardDay = fetchRewardDay as jest.MockedFunction<typeof fetchRewardDay>;

describe('useRewardedAdSsvPolling', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function mountHook(options?: UseRewardedAdSsvPollingOptions): Promise<{
    current: () => ReturnType<typeof useRewardedAdSsvPolling>;
  }> {
    const ref: { current: ReturnType<typeof useRewardedAdSsvPolling> | null } = { current: null };
    function Harness(props: UseRewardedAdSsvPollingOptions): null {
      ref.current = useRewardedAdSsvPolling(props);
      return null;
    }
    await act(async () => {
      TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <Harness {...(options ?? {})} />
        </QueryClientProvider>,
      );
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

  test('initially isVerifying is false', async () => {
    const { current } = await mountHook();
    expect(current().isVerifying).toBe(false);
  });

  test('startPolling sets isVerifying to true and triggers onSuccess when adsRemaining decrements', async () => {
    const onSuccess = jest.fn();
    const onTimeout = jest.fn();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    mockFetchRewardDay.mockResolvedValue({
      adsRemaining: 2,
      coinsRemaining: 20,
      balance: 10,
      resetsAt: '2026-09-15T00:00:00Z',
      premiumClaimed: false,
    } as RewardDayView);

    const { current } = await mountHook({
      onSuccess,
      onTimeout,
      intervalMs: 1000,
      maxPolls: 3,
    });

    act(() => {
      current().startPolling({ adsRemaining: 3, balance: 0 });
    });

    expect(current().isVerifying).toBe(true);

    // Advance timer to trigger first poll
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(mockFetchRewardDay).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
    expect(current().isVerifying).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['economy', 'balance'] });
  });

  test('triggers onTimeout when maxPolls is exhausted without adsRemaining changing', async () => {
    const onSuccess = jest.fn();
    const onTimeout = jest.fn();

    mockFetchRewardDay.mockResolvedValue({
      adsRemaining: 3,
      coinsRemaining: 30,
      balance: 0,
      resetsAt: '2026-09-15T00:00:00Z',
      premiumClaimed: false,
    } as RewardDayView);

    const { current } = await mountHook({
      onSuccess,
      onTimeout,
      intervalMs: 1000,
      maxPolls: 3,
    });

    act(() => {
      current().startPolling({ adsRemaining: 3, balance: 0 });
    });

    expect(current().isVerifying).toBe(true);

    // Advance through all 3 intervals
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
      });
    }

    expect(mockFetchRewardDay).toHaveBeenCalledTimes(3);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onTimeout).toHaveBeenCalled();
    expect(current().isVerifying).toBe(false);
  });
});
