import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

const staticConfig = require('./app.json').expo as ExpoConfig;

// ADR-0055. The Google service files are committed under credentials/ because
// android/ and ios/ are untracked prebuild output. They are client-side
// identifiers rather than secrets, and a checkout without them must still
// build: when either is missing the Firebase plugin is left out entirely and
// the app runs with no Analytics at all.
const ANDROID_GOOGLE_SERVICES = './credentials/firebase/google-services.json';
const IOS_GOOGLE_SERVICES = './credentials/firebase/GoogleService-Info.plist';

export default function appConfig(_context: ConfigContext): ExpoConfig {
  const iosUrlScheme =
    process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME ??
    reverseGoogleClientId(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);
  const plugins = [...(staticConfig.plugins ?? [])];

  if (iosUrlScheme !== undefined) {
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme },
    ]);
  }

  // AdMob (ADR-0033). App IDs are baked into the native projects at build time
  // by this config plugin; they come from EXPO_PUBLIC_ADMOB_*_APP_ID so each
  // environment (dev test IDs vs real console IDs) prebuilds with its own value.
  const androidAppId = process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID;
  const iosAppId = process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID;
  if (androidAppId !== undefined && iosAppId !== undefined) {
    plugins.push([
      'react-native-google-mobile-ads',
      { androidAppId, iosAppId },
    ]);
  }

  // ADR-0055: native Firebase Analytics. Registered only when BOTH service
  // files are present, so a clone without credentials still prebuilds.
  const androidGoogleServices = resolve(__dirname, ANDROID_GOOGLE_SERVICES);
  const iosGoogleServices = resolve(__dirname, IOS_GOOGLE_SERVICES);
  const hasFirebaseServiceFiles =
    existsSync(androidGoogleServices) && existsSync(iosGoogleServices);
  if (hasFirebaseServiceFiles) {
    // disableSPM: RNFirebase resolves firebase-ios-sdk through Swift Package
    // Manager by default, whose products are automatic libraries. Under this
    // project's static pod linkage each Firebase pod would embed its own copy
    // and collide with duplicate symbols at link time, so Firebase is installed
    // through CocoaPods instead. The alternative - switching every pod to
    // dynamic frameworks - would change linkage for Skia, Sentry and RevenueCat
    // too, for no benefit here.
    plugins.push(['@react-native-firebase/app', { ios: { disableSPM: true } }]);
  }

  return {
    ...staticConfig,
    android: hasFirebaseServiceFiles
      ? { ...staticConfig.android, googleServicesFile: ANDROID_GOOGLE_SERVICES }
      : staticConfig.android,
    ios: hasFirebaseServiceFiles
      ? { ...staticConfig.ios, googleServicesFile: IOS_GOOGLE_SERVICES }
      : staticConfig.ios,
    plugins,
  };
}

function reverseGoogleClientId(clientId: string | undefined): string | undefined {
  const suffix = '.apps.googleusercontent.com';
  if (clientId === undefined || !clientId.endsWith(suffix)) {
    return undefined;
  }
  return `com.googleusercontent.apps.${clientId.slice(0, -suffix.length)}`;
}
