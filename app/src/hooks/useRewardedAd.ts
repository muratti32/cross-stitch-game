import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  AdEventType,
  RewardedAd,
  RewardedAdEventType,
  type RewardedAdReward,
  type ServerSideVerificationOptions,
} from 'react-native-google-mobile-ads';
import { getRewardedAdUnitId } from '../config';
import { initializeAdMob, isAdMobAvailable } from '../ads';

export type RewardedAdStatus =
  | 'unavailable' // No ad unit for this platform (e.g. web) — never loads.
  | 'loading' // A Rewarded Ad is being fetched.
  | 'loaded' // Ready to show.
  | 'showing' // Currently presented to the player.
  | 'error'; // Last load/show failed; a reload has been scheduled.

export interface UseRewardedAdOptions {
  /**
   * Server-side verification data forwarded to AdMob's SSV callback (ADR-0033).
   * `customData` must be the opaque backend player identity — never email,
   * provider identifiers, or other personal data. When omitted the ad still
   * loads, but the callback cannot resolve a player, so pass it before relying
   * on the authoritative grant.
   */
  serverSideVerification?: ServerSideVerificationOptions;
  /**
   * Fired on the client when AdMob reports the reward was earned. Per ADR-0033 a
   * client-reported completion never grants Coin on its own — it may only update
   * local UI while the authoritative grant waits for the SSV callback.
   */
  onEarnedReward?: (reward: RewardedAdReward) => void;
}

export interface UseRewardedAd {
  status: RewardedAdStatus;
  /** Convenience flag: the ad is loaded and `show()` can present it. */
  isLoaded: boolean;
  /** The last load/show error, cleared when a new load starts. */
  error: Error | null;
  /** Present the loaded ad. No-op unless `status === 'loaded'`. */
  show: () => void;
  /** Discard the current ad and fetch a fresh one. */
  reload: () => void;
}

/**
 * Loads and presents a single AdMob Rewarded Ad, keeping one preloaded so the
 * player-started ad can be shown without a visible wait. A Rewarded Ad instance
 * is single-use, so the hook transparently reloads after each dismissal.
 */
export function useRewardedAd(options: UseRewardedAdOptions = {}): UseRewardedAd {
  const { serverSideVerification, onEarnedReward } = options;

  const [status, setStatus] = useState<RewardedAdStatus>(() =>
    isAdMobAvailable() ? 'loading' : 'unavailable',
  );
  const [error, setError] = useState<Error | null>(null);

  const adRef = useRef<RewardedAd | null>(null);
  // Keep the latest reward callback without recreating the ad on every render.
  const onEarnedRewardRef = useRef(onEarnedReward);
  onEarnedRewardRef.current = onEarnedReward;

  // Recreate the ad only when the SSV data actually changes — it is baked into
  // the request at load time and cannot be mutated afterwards.
  const ssvKey = serverSideVerification
    ? `${serverSideVerification.userId ?? ''}|${serverSideVerification.customData ?? ''}`
    : '';

  useEffect(() => {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      return;
    }
    const adUnitId = getRewardedAdUnitId(Platform.OS);
    if (adUnitId === undefined) {
      return;
    }

    let cancelled = false;
    const rewarded = RewardedAd.createForAdRequest(adUnitId, {
      // ADR-0033: non-personalized / no-IDFA delivery, no ATT prompt.
      requestNonPersonalizedAdsOnly: true,
      serverSideVerificationOptions: serverSideVerification,
    });
    adRef.current = rewarded;

    const unsubLoaded = rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
      if (cancelled) {
        return;
      }
      setError(null);
      setStatus('loaded');
    });

    const unsubEarned = rewarded.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      (reward) => {
        onEarnedRewardRef.current?.(reward);
      },
    );

    const unsubError = rewarded.addAdEventListener(AdEventType.ERROR, (adError) => {
      if (cancelled) {
        return;
      }
      setError(adError instanceof Error ? adError : new Error(String(adError)));
      setStatus('error');
    });

    const unsubClosed = rewarded.addAdEventListener(AdEventType.CLOSED, () => {
      if (cancelled) {
        return;
      }
      // A Rewarded Ad instance cannot be replayed; fetch the next one so the
      // player can start another ad without waiting.
      setStatus('loading');
      rewarded.load();
    });

    setStatus('loading');
    setError(null);
    // Ensure the SDK is initialized before the first request; the promise is
    // resolved immediately on subsequent loads.
    initializeAdMob()
      .then(() => {
        if (!cancelled) {
          rewarded.load();
        }
      })
      .catch((initError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(initError instanceof Error ? initError : new Error(String(initError)));
        setStatus('error');
      });

    return () => {
      cancelled = true;
      unsubLoaded();
      unsubEarned();
      unsubError();
      unsubClosed();
      adRef.current = null;
    };
    // ssvKey captures the meaningful part of serverSideVerification; the object
    // identity itself is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ssvKey]);

  const show = useCallback(() => {
    const ad = adRef.current;
    if (ad === null || !ad.loaded) {
      return;
    }
    setStatus('showing');
    ad.show().catch((showError: unknown) => {
      setError(showError instanceof Error ? showError : new Error(String(showError)));
      setStatus('error');
    });
  }, []);

  const reload = useCallback(() => {
    const ad = adRef.current;
    if (ad === null) {
      return;
    }
    setError(null);
    setStatus('loading');
    ad.load();
  }, []);

  return {
    status,
    isLoaded: status === 'loaded',
    error,
    show,
    reload,
  };
}
