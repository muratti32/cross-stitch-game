import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import {
  GoogleSignin,
  isCancelledResponse,
} from '@react-native-google-signin/google-signin';
import {
  getIdToken,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  signOut,
  type AuthCredential,
} from 'firebase/auth';

import {
  Config,
  isFirebaseSsoConfigured,
  isGoogleSsoConfigured,
} from '../config';
import { exchangeFirebaseIdToken } from './federatedAuth';
import {
  FirebaseSsoConfigurationError,
  getFirebaseSsoAuth,
} from './firebaseClient';

export type FirebaseSsoResult = { kind: 'cancelled' } | { kind: 'signed-in' };

export function canUseGoogleSso(): boolean {
  return (Platform.OS === 'android' || Platform.OS === 'ios') &&
    isGoogleSsoConfigured();
}

export async function canUseAppleSso(): Promise<boolean> {
  return (
    Platform.OS === 'ios' &&
    isFirebaseSsoConfigured() &&
    (await AppleAuthentication.isAvailableAsync())
  );
}

export async function signInWithGoogleSso(): Promise<FirebaseSsoResult> {
  if (!canUseGoogleSso()) {
    throw new FirebaseSsoConfigurationError();
  }

  GoogleSignin.configure({
    iosClientId: Config.google.iosClientId,
    offlineAccess: false,
    webClientId: Config.google.webClientId,
  });
  if (Platform.OS === 'android') {
    await GoogleSignin.hasPlayServices({
      showPlayServicesUpdateDialog: true,
    });
  }

  const response = await GoogleSignin.signIn();
  if (isCancelledResponse(response)) {
    return { kind: 'cancelled' };
  }
  if (response.data.idToken === null) {
    throw new Error('Google did not return an ID token');
  }

  const credential = GoogleAuthProvider.credential(response.data.idToken);
  return signInWithFirebaseCredential(credential);
}

export async function signInWithAppleSso(): Promise<FirebaseSsoResult> {
  if (!(await canUseAppleSso())) {
    throw new FirebaseSsoConfigurationError();
  }

  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  try {
    const appleCredential = await AppleAuthentication.signInAsync({
      nonce: hashedNonce,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (appleCredential.identityToken === null) {
      throw new Error('Apple did not return an identity token');
    }

    const provider = new OAuthProvider('apple.com');
    const credential = provider.credential({
      idToken: appleCredential.identityToken,
      rawNonce,
    });
    return signInWithFirebaseCredential(credential);
  } catch (error) {
    if (hasErrorCode(error, 'ERR_REQUEST_CANCELED')) {
      return { kind: 'cancelled' };
    }
    throw error;
  }
}

async function signInWithFirebaseCredential(
  credential: AuthCredential,
): Promise<FirebaseSsoResult> {
  const auth = getFirebaseSsoAuth();
  try {
    const result = await signInWithCredential(auth, credential);
    const firebaseIdToken = await getIdToken(result.user, true);
    await exchangeFirebaseIdToken(firebaseIdToken);
    return { kind: 'signed-in' };
  } finally {
    // Firebase is an identity broker only. Game Backend tokens own the actual
    // app session, so a Firebase session never remains active on the device.
    await signOut(auth).catch(() => undefined);
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
