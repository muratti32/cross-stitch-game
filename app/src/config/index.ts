export const Config = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000',
  firebase: {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
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
};

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
