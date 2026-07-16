import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createRequire } from 'node:module';
import type { App, ServiceAccount } from 'firebase-admin/app';
import type { Auth } from 'firebase-admin/auth';

import { AppConfigService } from '../config/app-config.service';
import type {
  FirebaseIdentityVerifier,
  FirebaseProviderIdentity,
} from './firebase-identity-verifier';

const FIREBASE_ADMIN_APP_NAME = 'stitch-wish-federated-auth';
const loadModule = createRequire(__filename);

@Injectable()
export class FirebaseAdminIdentityVerifier
  implements FirebaseIdentityVerifier
{
  private firebaseAuth: Auth | null = null;

  constructor(private readonly config: AppConfigService) {}

  async verify(idToken: string): Promise<FirebaseProviderIdentity> {
    try {
      const firebaseAuth = this.getFirebaseAuth();
      const decoded = await firebaseAuth.verifyIdToken(idToken, true);
      const signInProvider = decoded.firebase.sign_in_provider;
      const provider = toGameProvider(signInProvider);
      const user = await firebaseAuth.getUser(decoded.uid);
      if (user.disabled) {
        throw new UnauthorizedException('Firebase account is disabled');
      }

      const providerRecord = user.providerData.find(
        (candidate) => candidate.providerId === signInProvider,
      );
      if (providerRecord === undefined || providerRecord.uid.length === 0) {
        throw new UnauthorizedException('Firebase provider identity is missing');
      }

      return {
        email: providerRecord.email ?? user.email ?? null,
        provider,
        subject: providerRecord.uid,
      };
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      throw new UnauthorizedException('Invalid Firebase ID token');
    }
  }

  private getFirebaseAuth(): Auth {
    if (this.firebaseAuth !== null) {
      return this.firebaseAuth;
    }

    const projectId = this.config.firebaseProjectId;
    if (projectId === undefined) {
      throw new ServiceUnavailableException(
        'Firebase authentication is not configured',
      );
    }

    // Keep the Admin SDK out of the process until this endpoint is used. This
    // also lets API/integration tests boot without parsing Firebase's optional
    // ESM-only transitive dependencies.
    const {
      applicationDefault,
      cert,
      getApp,
      initializeApp,
    } = loadModule('firebase-admin/app') as typeof import('firebase-admin/app');
    const { getAuth } = loadModule('firebase-admin/auth') as typeof import(
      'firebase-admin/auth'
    );

    let app: App;
    try {
      app = getApp(FIREBASE_ADMIN_APP_NAME);
    } catch {
      const encodedServiceAccount =
        this.config.firebaseServiceAccountBase64;
      const credential = encodedServiceAccount
        ? cert(decodeServiceAccount(encodedServiceAccount))
        : applicationDefault();
      app = initializeApp(
        {
          credential,
          projectId,
        },
        FIREBASE_ADMIN_APP_NAME,
      );
    }

    this.firebaseAuth = getAuth(app);
    return this.firebaseAuth;
  }
}

function toGameProvider(
  signInProvider: string,
): FirebaseProviderIdentity['provider'] {
  if (signInProvider === 'google.com') {
    return 'google';
  }
  if (signInProvider === 'apple.com') {
    return 'apple';
  }
  throw new UnauthorizedException('Firebase provider is not allowed');
}

function decodeServiceAccount(encoded: string): ServiceAccount {
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf8');
    return JSON.parse(json) as ServiceAccount;
  } catch {
    throw new ServiceUnavailableException(
      'Firebase service account configuration is invalid',
    );
  }
}
