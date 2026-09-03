export const Config = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000',
  // Public marketing/legal site (Cloudflare DNS -> Coolify `website` app). It
  // hosts the Privacy Policy, Terms of Service, Support, and Account Deletion
  // pages the stores require, and is also the Catalog Share Link web fallback.
  webBaseUrl: (process.env.EXPO_PUBLIC_WEB_BASE_URL || 'https://stitchwish.avkdesign.net').replace(
    /\/+$/,
    '',
  ),
  firebase: {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  },
  // ADR-0055. Collection is off in development builds so local testing cannot
  // distort production reporting; this opts a single dev device back in for
  // Firebase DebugView verification.
  firebaseAnalytics: {
    enabledInDevelopment: process.env.EXPO_PUBLIC_FIREBASE_ANALYTICS_ENABLED === 'true',
  },
  google: {
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  },
  sentry: {
    // Public client key (Sentry DSNs are not secrets). Left undefined to
    // silently disable Sentry in environments that haven't set it, e.g. a
    // machine without the shared .env values.
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    environment:
      process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT || (__DEV__ ? 'development' : 'production'),
  },
  admob: {
    // Rewarded-ad-only (ADR-0033). App IDs are consumed at build time by the
    // native config plugin (see app.config.ts); the ad unit IDs below are read
    // at runtime to request the Rewarded Ad. These are Google's public test IDs
    // in dev and the real per-environment IDs in TestFlight/production builds.
    androidRewardedAdUnitId: process.env.EXPO_PUBLIC_ADMOB_ANDROID_REWARDED_AD_UNIT_ID,
    iosRewardedAdUnitId: process.env.EXPO_PUBLIC_ADMOB_IOS_REWARDED_AD_UNIT_ID,
  },
};

/**
 * Public web pages linked from the app. Every route here exists in the
 * `website/` Vite app (see website/src/App.tsx).
 */
export const WebLinks = {
  privacyPolicy: `${Config.webBaseUrl}/privacy-policy`,
  termsOfService: `${Config.webBaseUrl}/terms-of-service`,
  support: `${Config.webBaseUrl}/support`,
  accountDeletion: `${Config.webBaseUrl}/account-deletion`,
} as const;

export function isSentryConfigured(): boolean {
  return Boolean(Config.sentry.dsn);
}

export function isFirebaseSsoConfigured(): boolean {
  return Boolean(
    Config.firebase.apiKey &&
      Config.firebase.appId &&
      Config.firebase.projectId,
  );
}

export function isGoogleSsoConfigured(): boolean {
  return Boolean(
    isFirebaseSsoConfigured() &&
      Config.google.iosClientId &&
      Config.google.webClientId,
  );
}

const GOOGLE_TEST_REWARDED_AD_UNIT_IOS = 'ca-app-pub-3940256099942544/1712485313';
const GOOGLE_TEST_REWARDED_AD_UNIT_ANDROID = 'ca-app-pub-3940256099942544/5224354917';

/**
 * The Rewarded Ad unit ID for the current platform, or undefined when AdMob is
 * not configured for it (e.g. web, where the SDK is unavailable).
 */
export function getRewardedAdUnitId(platform: 'android' | 'ios'): string | undefined {
  const configured =
    platform === 'ios'
      ? Config.admob.iosRewardedAdUnitId
      : Config.admob.androidRewardedAdUnitId;

  if (configured) {
    return configured;
  }
  if (__DEV__) {
    return platform === 'ios'
      ? GOOGLE_TEST_REWARDED_AD_UNIT_IOS
      : GOOGLE_TEST_REWARDED_AD_UNIT_ANDROID;
  }
  return undefined;
}
