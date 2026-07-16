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
