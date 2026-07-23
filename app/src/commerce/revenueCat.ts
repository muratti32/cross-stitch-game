import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import { Platform } from 'react-native';

let configured = false;

export function configureRevenueCat(accountId: string): void {
  const apiKey = Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_IOS
    : process.env.EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID;
  if (!apiKey) {
    console.warn('RevenueCat API key is not configured; commerce is disabled.');
    return;
  }
  if (configured) return;
  Purchases.configure({ apiKey, appUserID: accountId });
  configured = true;
}

export function isRevenueCatConfigured(): boolean {
  return configured;
}
