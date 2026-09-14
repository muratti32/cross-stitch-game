import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { coinBalanceQueryKey, fetchAdAttemptState, rewardDayQueryKey } from '../api/economy';
import { membershipQueryKey } from '../api/membership';
import { captureAdRewardVerificationError } from '../observability/sentry';

const INITIAL_DELAY_MS = 1500;
const MAX_DELAY_MS = 10_000;
const EXPIRY_GRACE_MS = 2_000;

export interface UseRewardedAdSsvPollingOptions {
  onVerified?: () => void;
  /** The polling window ended without a verdict; the callback may still land. */
  onPending?: () => void;
  /** The backend says the attempt expired unconsumed; no Coins will be granted. */
  onExpired?: () => void;
}

export function useRewardedAdSsvPolling(options: UseRewardedAdSsvPollingOptions = {}) {
  const queryClient = useQueryClient();
  const [isVerifying, setIsVerifying] = useState(false);
  const generationRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const stopPolling = useCallback((updateState = true) => {
    generationRef.current += 1;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (updateState && mountedRef.current) setIsVerifying(false);
  }, []);

  const startPolling = useCallback((nonce: string, expiresAt: string) => {
    stopPolling();
    const generation = generationRef.current;
    const deadline = new Date(expiresAt).getTime() + EXPIRY_GRACE_MS;
    let delay = INITIAL_DELAY_MS;
    let errorReported = false;
    setIsVerifying(true);

    const isCurrent = () => mountedRef.current && generationRef.current === generation;
    const finishPending = () => {
      if (!isCurrent()) return;
      stopPolling();
      callbacksRef.current.onPending?.();
    };
    const schedule = () => {
      if (!isCurrent()) return;
      if (Date.now() >= deadline) return finishPending();
      timerRef.current = setTimeout(tick, Math.min(delay, deadline - Date.now()));
      delay = Math.min(Math.round(delay * 1.7), MAX_DELAY_MS);
    };
    const tick = async () => {
      if (!isCurrent()) return;
      try {
        const result = await fetchAdAttemptState(nonce);
        if (!isCurrent()) return;
        if (result.state === 'verified') {
          stopPolling();
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: coinBalanceQueryKey }),
            queryClient.invalidateQueries({ queryKey: rewardDayQueryKey }),
            queryClient.invalidateQueries({ queryKey: membershipQueryKey }),
          ]);
          if (!mountedRef.current || generationRef.current !== generation + 1) return;
          callbacksRef.current.onVerified?.();
          return;
        }
        if (result.state === 'expired') {
          stopPolling();
          callbacksRef.current.onExpired?.();
          return;
        }
      } catch (error: unknown) {
        if (!isCurrent()) return;
        if (!errorReported) {
          errorReported = true;
          captureAdRewardVerificationError(error);
        }
      }
      schedule();
    };
    schedule();
  }, [queryClient, stopPolling]);

  useEffect(() => () => {
    mountedRef.current = false;
    stopPolling(false);
  }, [stopPolling]);

  return { isVerifying, startPolling, stopPolling };
}
