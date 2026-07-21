import { Platform } from 'react-native';
import mobileAds from 'react-native-google-mobile-ads';
import { getRewardedAdUnitId } from '../config';

/**
 * AdMob (ADR-0033). The game's only advertising surface is the explicit,
 * player-started Rewarded Ad — no banners, interstitials, or ad-based AI Credit.
 *
 * Privacy posture (ADR-0033, docs/app-metadata.md): the first release serves
 * non-personalized / no-IDFA ads and never asks for App Tracking Transparency,
 * so requests are always made with `requestNonPersonalizedAdsOnly` (see
 * useRewardedAd). Nothing here requests the ATT prompt.
 */

let initializePromise: Promise<void> | null = null;

/**
 * True when a Rewarded Ad unit is configured for the current native platform.
 * False on web (the SDK is native-only) and whenever the env value is missing.
 */
export function isAdMobAvailable(): boolean {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return false;
  }
  return getRewardedAdUnitId(Platform.OS) !== undefined;
}

/**
 * Initialize the Google Mobile Ads SDK once. Idempotent: repeated calls return
 * the same in-flight/settled promise. A no-op (resolved) when AdMob is not
 * available for this platform, so callers can invoke it unconditionally.
 */
export function initializeAdMob(): Promise<void> {
  if (!isAdMobAvailable()) {
    return Promise.resolve();
  }
  if (initializePromise === null) {
    initializePromise = mobileAds()
      .initialize()
      .then(() => undefined)
      .catch((error: unknown) => {
        // Reset so a later attempt can retry; a failed init must not permanently
        // disable ads for the session.
        initializePromise = null;
        throw error;
      });
  }
  return initializePromise;
}
