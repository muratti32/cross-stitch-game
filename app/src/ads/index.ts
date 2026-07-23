import { Platform } from 'react-native';
import mobileAds, { AdsConsent } from 'react-native-google-mobile-ads';
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
let consentPromise: Promise<boolean> | null = null;
let consentResult: boolean | null = null;

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
 * Returns whether ads consent was granted, or null if not yet determined.
 */
export function hasAdsConsent(): boolean | null {
  return consentResult;
}

/**
 * Ensures UMP consent information has been gathered and a form presented if required.
 * Returns a promise resolving to canRequestAds.
 */
export function ensureAdsConsent(): Promise<boolean> {
  if (!isAdMobAvailable()) {
    return Promise.resolve(true);
  }
  if (consentPromise === null) {
    consentPromise = AdsConsent.gatherConsent()
      .then((info) => {
        consentResult = info.canRequestAds;
        return info.canRequestAds;
      })
      .catch((error: unknown) => {
        // Reset so a later attempt can retry
        consentPromise = null;
        throw error;
      });
  }
  return consentPromise;
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
    initializePromise = ensureAdsConsent()
      .then((canRequest) => {
        if (!canRequest) {
          return;
        }
        return mobileAds()
          .initialize()
          .then(() => undefined);
      })
      .catch((error: unknown) => {
        // Reset so a later attempt can retry; a failed init must not permanently
        // disable ads for the session.
        initializePromise = null;
        throw error;
      });
  }
  return initializePromise;
}

/**
 * Reset module-level promises and results for testing purposes.
 */
export function __resetAdMobGlobals(): void {
  initializePromise = null;
  consentPromise = null;
  consentResult = null;
}


