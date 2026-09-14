import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  coinBalanceQueryKey,
  rewardDayQueryKey,
  useClaimAdReward,
  useOpenAdAttempt,
  type AdAttempt,
} from '../api/economy';
import { membershipQueryKey } from '../api/membership';
import { useRewardedAd } from './useRewardedAd';
import { useRewardedAdSsvPolling } from './useRewardedAdSsvPolling';

export type AdRewardMessage = 'verifying' | 'verified' | 'pending' | null;

export function adRewardMessageKey(message: Exclude<AdRewardMessage, null>): string {
  if (message === 'verified') return 'home.dailyPool.adRewardEarned';
  if (message === 'verifying') return 'home.dailyPool.adRewardVerifying';
  return 'home.dailyPool.adRewardPending';
}

interface RewardedAdFlowOptions {
  localizeAttemptError: (error: unknown) => string;
  localizeClaimError: (error: unknown) => string;
  localizeLoadError: (error: Error | null) => string;
  localizeVerificationExpired: () => string;
}

export function useRewardedAdFlow(options: RewardedAdFlowOptions) {
  const queryClient = useQueryClient();
  const { mutateAsync: openAttempt } = useOpenAdAttempt();
  const { mutateAsync: claimReward } = useClaimAdReward();
  const [attempt, setAttempt] = useState<AdAttempt | null>(null);
  const [attemptPending, setAttemptPending] = useState(false);
  const [message, setMessage] = useState<AdRewardMessage>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;
  const claimingRef = useRef<Set<string>>(new Set());
  const earnedRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const resetAttempt = useCallback(() => {
    setAttempt(null);
    setAttemptPending(false);
  }, []);

  const polling = useRewardedAdSsvPolling({
    onVerified: () => {
      resetAttempt();
      setMessage('verified');
    },
    onPending: () => {
      resetAttempt();
      setMessage('pending');
    },
    onExpired: () => {
      resetAttempt();
      setMessage(null);
      setErrorMessage(optionsRef.current.localizeVerificationExpired());
    },
  });

  const invalidateEconomy = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: coinBalanceQueryKey }),
      queryClient.invalidateQueries({ queryKey: rewardDayQueryKey }),
      queryClient.invalidateQueries({ queryKey: membershipQueryKey }),
    ]);
  }, [queryClient]);

  const claim = useCallback(async (nonce: string) => {
    if (claimingRef.current.has(nonce)) return;
    claimingRef.current.add(nonce);
    try {
      await claimReward(nonce);
      await invalidateEconomy();
      setMessage('verified');
    } catch (error: unknown) {
      claimingRef.current.delete(nonce);
      setErrorMessage(optionsRef.current.localizeClaimError(error));
    }
  }, [claimReward, invalidateEconomy]);

  const { status, error, show } = useRewardedAd({
    serverSideVerification: attempt?.nonce ? { customData: attempt.nonce } : undefined,
    onEarnedReward: () => {
      const current = attemptRef.current;
      if (current === null) return;
      earnedRef.current = true;
      if (current.ssvActive === true) {
        // SSV owns the Coin grant; poll this attempt until its backend TTL ends.
        setMessage('verifying');
        polling.startPolling(current.nonce, current.expiresAt);
      } else {
        void claim(current.nonce);
      }
    },
  });
  const previousStatusRef = useRef(status);

  useEffect(() => {
    if (attemptPending && status === 'loaded') show();
  }, [status, attemptPending, show]);

  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = status;
    if (!attemptPending || previous !== 'showing' || status === 'showing') return;
    const current = attemptRef.current;
    if (current?.ssvActive === true) {
      if (!earnedRef.current) resetAttempt();
      return;
    }
    // Keep the attempt pending until the claim settles so the button can't start a second ad.
    const pendingClaim = current !== null && !claimingRef.current.has(current.nonce)
      ? claim(current.nonce)
      : Promise.resolve();
    void pendingClaim.then(invalidateEconomy).finally(resetAttempt);
  }, [status, attemptPending, claim, invalidateEconomy, resetAttempt]);

  useEffect(() => {
    if (attemptPending && status === 'error') {
      setErrorMessage(optionsRef.current.localizeLoadError(error));
      resetAttempt();
    }
  }, [error, status, attemptPending, resetAttempt]);

  const watch = useCallback(async () => {
    polling.stopPolling();
    resetAttempt();
    setErrorMessage(null);
    setMessage(null);
    earnedRef.current = false;
    setAttemptPending(true);
    try {
      setAttempt(await openAttempt());
    } catch (error: unknown) {
      resetAttempt();
      setErrorMessage(optionsRef.current.localizeAttemptError(error));
    }
  }, [openAttempt, polling.stopPolling, resetAttempt]);

  return {
    status,
    attemptPending,
    isVerifying: polling.isVerifying,
    message,
    errorMessage,
    watch,
  };
}
