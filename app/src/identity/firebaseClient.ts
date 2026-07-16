import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  inMemoryPersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';

import { Config, isFirebaseSsoConfigured } from '../config';

const FIREBASE_APP_NAME = 'stitch-wish-federated-auth';
let firebaseAuth: Auth | null = null;

export class FirebaseSsoConfigurationError extends Error {
  constructor() {
    super('Social sign-in is not configured for this build.');
    this.name = 'FirebaseSsoConfigurationError';
  }
}

export function getFirebaseSsoAuth(): Auth {
  if (firebaseAuth !== null) {
    return firebaseAuth;
  }
  if (!isFirebaseSsoConfigured()) {
    throw new FirebaseSsoConfigurationError();
  }

  const app = getOrCreateFirebaseApp();
  try {
    firebaseAuth = initializeAuth(app, {
      persistence: inMemoryPersistence,
    });
  } catch {
    firebaseAuth = getAuth(app);
  }
  return firebaseAuth;
}

function getOrCreateFirebaseApp(): FirebaseApp {
  const existing = getApps().find((app) => app.name === FIREBASE_APP_NAME);
  if (existing !== undefined) {
    return getApp(FIREBASE_APP_NAME);
  }

  return initializeApp(
    {
      apiKey: Config.firebase.apiKey,
      appId: Config.firebase.appId,
      authDomain: Config.firebase.authDomain,
      projectId: Config.firebase.projectId,
    },
    FIREBASE_APP_NAME,
  );
}
