import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchRewardDay } from '../api/economy';

export interface UseRewardedAdSsvPollingOptions {
  onSuccess?: () => void;
  onTimeout?: () => void;
  maxPolls?: number;
  intervalMs?: number;
}

export interface InitialRewardState {
  adsRemaining: number;
  balance?: number;
}

export interface UseRewardedAdSsvPollingResult {
  isVerifying: boolean;
  startPolling: (initialState: InitialRewardState) => void;
  stopPolling: () => void;
}

/**
 * Polls reward-day and balance queries while awaiting an authoritative AdMob
 * Server-Side Verification callback (ADR-0033 / Issue #247).
 *
 * When AdMob SSV is active, the client must not call /claim. Instead, it enters
 * Pending Ad Reward Verification and monitors the reward-day status until the
 * server grants the coin (adsRemaining decrements / balance increments) or the
 * polling window expires without error.
 */
export function useRewardedAdSsvPolling(
  options: UseRewardedAdSsvPollingOptions = {},
): UseRewardedAdSsvPollingResult {
  const { onSuccess, onTimeout, maxPolls = 5, intervalMs = 1500 } = options;
  const queryClient = useQueryClient();
  const [isVerifying, setIsVerifying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseAdsRemainingRef = useRef<number>(0);
  const baseBalanceRef = useRef<number>(0);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsVerifying(false);
  }, []);

  const startPolling = useCallback(
    (initialState: InitialRewardState) => {
      stopPolling();
      baseAdsRemainingRef.current = initialState.adsRemaining;
      baseBalanceRef.current = initialState.balance ?? 0;
      setIsVerifying(true);
      let pollsRemaining = maxPolls;

      timerRef.current = setInterval(async () => {
        try {
          const rewardDay = await queryClient.fetchQuery({
            queryKey: ['economy', 'reward-day'],
            queryFn: fetchRewardDay,
          });

          if (
            rewardDay.adsRemaining < baseAdsRemainingRef.current ||
            rewardDay.balance > baseBalanceRef.current
          ) {
            stopPolling();
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['economy', 'balance'] }),
              queryClient.invalidateQueries({ queryKey: ['commerce', 'membership'] }),
            ]);
            onSuccessRef.current?.();
            return;
          }
        } catch {
          // Ignore transient fetch errors and continue polling
        }

        pollsRemaining -= 1;
        if (pollsRemaining <= 0) {
          stopPolling();
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['economy', 'reward-day'] }),
            queryClient.invalidateQueries({ queryKey: ['economy', 'balance'] }),
          ]);
          onTimeoutRef.current?.();
        }
      }, intervalMs);
    },
    [queryClient, stopPolling, maxPolls, intervalMs],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return {
    isVerifying,
    startPolling,
    stopPolling,
  };
}
