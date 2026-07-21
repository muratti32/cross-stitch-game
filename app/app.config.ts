import type { ConfigContext, ExpoConfig } from 'expo/config';

const staticConfig = require('./app.json').expo as ExpoConfig;

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

  return {
    ...staticConfig,
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
